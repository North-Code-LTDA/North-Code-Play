import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, Loader2, AlertCircle, Check, X, Pencil } from 'lucide-react';
import { XtreamService } from '../services/xtreamService';
import { MediaImage } from '../components/MediaImage';
import {
  extractPersistableUserInfo,
  readAutoLoginState,
  safeSaveCredentials,
} from '../utils/accountUtils';
import {
  extractXtreamCredentialsFromUrl,
  normalizeAllowedOutputFormats,
  normalizeServerUrl,
} from '../utils/mediaUtils';
import { XtreamCredentials } from '../types';
import {
  useBackHandler,
  BACK_PRIORITY,
  pushFocusMemory,
  popFocusMemory,
  focusElementSafely,
} from '../navigation';
import { usePerformanceProfile } from '../platform/performanceProfile';

const AVATAR_OPTIONS = [
  'https://api.dicebear.com/10.x/fun-emoji/svg?seed=Sophie',
  'https://api.dicebear.com/10.x/fun-emoji/svg?seed=Felix',
  'https://api.dicebear.com/10.x/fun-emoji/svg?seed=Aneka',
  'https://api.dicebear.com/10.x/identicon/svg?seed=Sophie',
  'https://api.dicebear.com/10.x/identicon/svg?seed=Aneka',
  'https://api.dicebear.com/10.x/identicon/svg?seed=Luna',
  'https://api.dicebear.com/10.x/thumbs/svg?seed=Aneka',
  'https://api.dicebear.com/10.x/thumbs/svg?seed=Luna',
  'https://api.dicebear.com/10.x/thumbs/svg?seed=Sophie',
];

export function Login() {
  const [playlistName, setPlaylistName] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_OPTIONS[0]);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const avatarPickerRef = useRef<HTMLDivElement | null>(null);

  const { isLiteActive } = usePerformanceProfile();
  const navigate = useNavigate();
  const location = useLocation();

  // Ao reabrir o aplicativo na rota inicial (/), retoma automaticamente /home se houver sessão válida salva.
  // Se as credenciais salvas tiverem sido recusadas/expiradas (isAuthRejected) ou se o usuário abriu o Login
  // para corrigir dados (editCredentials), permanece no formulário com os dados preenchidos para edição.
  useEffect(() => {
    const locState = (location?.state as Record<string, any> | null) || null;
    const searchParams = new URLSearchParams(location?.search || '');
    const editRequested =
      Boolean(locState?.editCredentials) || searchParams.get('edit') === '1';

    const autoState = readAutoLoginState();

    if (autoState.canAutoLogin && !editRequested) {
      navigate('/home', { replace: true });
      return;
    }

    if (autoState.credentials) {
      const saved = autoState.credentials;
      if (typeof saved.playlistName === 'string' && saved.playlistName.trim()) {
        setPlaylistName(saved.playlistName);
      }
      if (typeof saved.avatar === 'string' && saved.avatar.trim()) {
        setAvatar(saved.avatar);
      }
      if (typeof saved.serverUrl === 'string') {
        setServerUrl(saved.serverUrl);
      }
      if (typeof saved.username === 'string') {
        setUsername(saved.username);
      }
      if (typeof saved.password === 'string') {
        setPassword(saved.password);
      }
    }

    const recoveryMessage =
      (typeof locState?.authError === 'string' && locState.authError.trim()) ||
      (autoState.isAuthRejected && autoState.authError) ||
      null;

    if (recoveryMessage) {
      setError(recoveryMessage);
    }
  }, [navigate, location]);

  const closeAvatarPickerAndRestoreFocus = () => {
    setShowAvatarPicker(false);
    const restored = popFocusMemory();
    if (!restored && avatarTriggerRef.current) {
      focusElementSafely(avatarTriggerRef.current);
    }
  };

  useBackHandler(
    'login-avatar-picker',
    BACK_PRIORITY.SUB_MODAL,
    () => {
      if (showAvatarPicker) {
        closeAvatarPickerAndRestoreFocus();
        return true;
      }
      return false;
    },
    showAvatarPicker
  );

  // Fechar seletor de avatar com clique externo ou tecla Escape no desktop
  useEffect(() => {
    if (!showAvatarPicker) return;

    const handlePointerDownOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        avatarPickerRef.current &&
        !avatarPickerRef.current.contains(target) &&
        avatarTriggerRef.current &&
        !avatarTriggerRef.current.contains(target)
      ) {
        closeAvatarPickerAndRestoreFocus();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeAvatarPickerAndRestoreFocus();
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAvatarPicker]);

  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const extracted = extractXtreamCredentialsFromUrl(value);
    if (extracted) {
      setServerUrl(extracted.serverUrl);
      setUsername(extracted.username);
      setPassword(extracted.password);
      return;
    }

    setServerUrl(value);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    const extractedOnSubmit = extractXtreamCredentialsFromUrl(serverUrl);
    const rawServerInput = extractedOnSubmit ? extractedOnSubmit.serverUrl : serverUrl;
    const effectiveUsername = (extractedOnSubmit && !username.trim()
      ? extractedOnSubmit.username
      : username
    ).trim();
    const effectivePassword =
      extractedOnSubmit && !password ? extractedOnSubmit.password : password;

    const normalizedServerUrl = normalizeServerUrl(rawServerInput);
    if (!normalizedServerUrl) {
      setError(
        'Informe uma URL de servidor HTTP ou HTTPS válida (ex.: http://servidor.com:8080).'
      );
      setIsLoading(false);
      return;
    }

    if (extractedOnSubmit) {
      setServerUrl(normalizedServerUrl);
      if (!username.trim()) setUsername(effectiveUsername);
      if (!password) setPassword(effectivePassword);
    }

    const baseCredentials: XtreamCredentials = {
      playlistName: playlistName.trim() || 'Minha Lista',
      serverUrl: normalizedServerUrl,
      username: effectiveUsername,
      password: effectivePassword,
      avatar,
    };

    try {
      // Validate credentials directly against Xtream server
      const authResponse = await XtreamService.authenticate(baseCredentials);

      const normalizedFormats = normalizeAllowedOutputFormats(
        authResponse?.user_info?.allowed_output_formats
      );
      const persistableUserInfo = extractPersistableUserInfo(authResponse?.user_info);
      const rawServerInfo =
        authResponse?.server_info &&
        typeof authResponse.server_info === 'object' &&
        !Array.isArray(authResponse.server_info)
          ? authResponse.server_info
          : undefined;

      const fullCredentials: XtreamCredentials = {
        ...baseCredentials,
        ...(normalizedFormats !== undefined
          ? { allowed_output_formats: normalizedFormats }
          : {}),
        ...(persistableUserInfo ? { user_info: persistableUserInfo } : {}),
        ...(rawServerInfo ? { server_info: rawServerInfo } : {}),
      };

      // If validation succeeds, save and redirect
      const saveRes = safeSaveCredentials(fullCredentials);
      if (!saveRes.success) {
        setError(
          'Falha no armazenamento local do navegador ao salvar a sessão. Libere espaço no navegador e tente novamente.'
        );
        return;
      }
      navigate('/home');
    } catch (err: any) {
      setError(err.message || 'Falha na autenticação. Verifique os dados inseridos.');
    } finally {
      setIsLoading(false);
    }
  };

  const isSubmitDisabled =
    isLoading || !serverUrl.trim() || !username.trim() || !password;

  return (
    <div
      data-login-screen="true"
      className="min-h-[100dvh] nc-safe-login flex flex-col items-center justify-center relative overflow-x-hidden overflow-y-auto bg-nc-bg py-8 sm:py-12"
    >
      {/* Vinheta cinematográfica discreta em tons neutros */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.045)_0%,rgba(0,0,0,0)_58%)]"
      />

      <motion.div
        data-login-lite-motion={isLiteActive ? 'true' : 'false'}
        initial={isLiteActive ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={isLiteActive ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[460px] z-10 px-1 sm:px-0"
      >
        {/* Marca oficial em destaque equilibrado */}
        <div className="flex justify-center mb-7 sm:mb-9">
          <Logo className="scale-105 sm:scale-110" />
        </div>

        {/* Cartão principal de autenticação */}
        <div className="bg-nc-bg-card border border-white/10 rounded-2xl p-6 sm:p-8 md:p-9 shadow-[0_24px_64px_rgba(0,0,0,0.8)]">
          <div className="mb-7">
            <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-white">
              Entrar
            </h1>
            <p className="text-sm text-nc-text-secondary mt-1.5 leading-relaxed">
              Informe os dados da sua lista para acessar o catálogo.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
            {/* Perfil da Lista: Avatar + Nome da Lista (Opcional) */}
            <div className="space-y-1.5 relative">
              <label
                htmlFor="playlistName"
                className="text-sm font-medium text-neutral-300 block"
              >
                Nome da Lista{' '}
                <span className="text-nc-text-secondary font-normal text-xs">
                  (Opcional)
                </span>
              </label>

              <div className="flex gap-3 items-center">
                <button
                  ref={avatarTriggerRef}
                  type="button"
                  data-nav-item="true"
                  data-avatar-trigger="true"
                  aria-label="Selecionar avatar"
                  aria-expanded={showAvatarPicker}
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    if (!showAvatarPicker) {
                      pushFocusMemory(e.currentTarget);
                      setShowAvatarPicker(true);
                    } else {
                      closeAvatarPickerAndRestoreFocus();
                    }
                  }}
                  className="relative w-12 h-12 sm:w-[52px] sm:h-[52px] rounded-full shrink-0 border border-white/20 hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-nc-bg-card transition-colors bg-nc-bg-input cursor-pointer group"
                >
                  <span className="block w-full h-full rounded-full overflow-hidden">
                    <MediaImage
                      src={avatar}
                      alt="Avatar selecionado"
                      className="w-full h-full object-cover"
                    />
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-nc-bg border border-white/25 flex items-center justify-center text-neutral-300 group-hover:text-white group-hover:border-white/60 transition-colors"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </span>
                </button>

                <input
                  id="playlistName"
                  type="text"
                  autoComplete="off"
                  placeholder="Ex: Minha TV"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="flex-1 min-w-0 min-h-[48px] bg-nc-bg-input border border-white/12 rounded-xl px-4 py-3 text-base sm:text-sm text-white placeholder:text-neutral-500 hover:border-white/25 focus:outline-none focus:border-white/80 focus:ring-2 focus:ring-white/20 transition-all duration-150"
                />
              </div>

              <AnimatePresence>
                {showAvatarPicker && (
                  <motion.div
                    ref={avatarPickerRef}
                    role="dialog"
                    aria-label="Escolher avatar"
                    data-focus-scope="modal"
                    data-avatar-picker="true"
                    data-avatar-picker-lite-motion={isLiteActive ? 'true' : 'false'}
                    initial={isLiteActive ? false : { opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={
                      isLiteActive
                        ? { opacity: 1, y: 0, scale: 1, transition: { duration: 0 } }
                        : { opacity: 0, y: -6, scale: 0.98 }
                    }
                    transition={
                      isLiteActive ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }
                    }
                    className="absolute top-[86px] left-0 z-30 bg-[#101010] border border-white/15 rounded-2xl p-4 shadow-[0_24px_60px_rgba(0,0,0,0.9)] w-full"
                  >
                    <div className="flex items-center justify-between gap-2 mb-3.5">
                      <p className="text-xs font-medium text-neutral-300">
                        Escolha um avatar
                      </p>
                      <button
                        type="button"
                        data-nav-item="true"
                        aria-label="Fechar seletor de avatar"
                        onClick={closeAvatarPickerAndRestoreFocus}
                        className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 justify-items-center">
                      {AVATAR_OPTIONS.map((opt, idx) => {
                        const isSelected = avatar === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            data-nav-item="true"
                            data-avatar-option={idx}
                            aria-label={`Avatar ${idx + 1}`}
                            aria-pressed={isSelected}
                            onClick={() => {
                              setAvatar(opt);
                              closeAvatarPickerAndRestoreFocus();
                            }}
                            className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#101010] cursor-pointer ${
                              isSelected
                                ? 'border-white ring-2 ring-white/25 scale-[1.04]'
                                : 'border-white/10 hover:border-white/40 bg-white/[0.03]'
                            }`}
                          >
                            <span className="block w-full h-full rounded-full overflow-hidden">
                              <MediaImage
                                src={opt}
                                alt={`Opção de avatar ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </span>
                            {isSelected && (
                              <span
                                aria-hidden="true"
                                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white text-black flex items-center justify-center shadow-md"
                              >
                                <Check className="w-3 h-3 stroke-[3]" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* URL do Servidor */}
            <div className="space-y-1.5">
              <label
                htmlFor="serverUrl"
                className="text-sm font-medium text-neutral-300 block"
              >
                URL do Servidor
              </label>
              <input
                id="serverUrl"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoComplete="url"
                placeholder="http://exemplo.com:8080 ou link M3U"
                value={serverUrl}
                onChange={handleServerUrlChange}
                className="w-full min-h-[48px] bg-nc-bg-input border border-white/12 rounded-xl px-4 py-3 text-base sm:text-sm text-white placeholder:text-neutral-500 hover:border-white/25 focus:outline-none focus:border-white/80 focus:ring-2 focus:ring-white/20 transition-all duration-150"
              />
            </div>

            {/* Usuário */}
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="text-sm font-medium text-neutral-300 block"
              >
                Usuário
              </label>
              <input
                id="username"
                type="text"
                required
                autoComplete="username"
                placeholder="Seu usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full min-h-[48px] bg-nc-bg-input border border-white/12 rounded-xl px-4 py-3 text-base sm:text-sm text-white placeholder:text-neutral-500 hover:border-white/25 focus:outline-none focus:border-white/80 focus:ring-2 focus:ring-white/20 transition-all duration-150"
              />
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium text-neutral-300 block"
              >
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[48px] bg-nc-bg-input border border-white/12 rounded-xl py-3 pl-4 pr-12 text-base sm:text-sm text-white placeholder:text-neutral-500 hover:border-white/25 focus:outline-none focus:border-white/80 focus:ring-2 focus:ring-white/20 transition-all duration-150"
                />
                <button
                  type="button"
                  data-nav-item="true"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg inline-flex items-center justify-center text-nc-text-secondary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <Eye className="w-5 h-5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2.5 px-4 py-3 bg-red-500/10 border border-red-500/35 rounded-xl text-red-200"
              >
                <AlertCircle
                  className="w-4 h-4 text-red-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-sm leading-snug break-words">{error}</p>
              </div>
            )}

            <button
              type="submit"
              data-nav-item="true"
              disabled={isSubmitDisabled}
              className="w-full min-h-[50px] bg-nc-primary text-black font-semibold text-base rounded-xl py-3 mt-2 hover:bg-nc-primary-hover active:scale-[0.985] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-nc-bg-card transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-black" aria-hidden="true" />
                  <span>Entrando...</span>
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-neutral-500 text-xs mt-6">
          North Code Play
        </p>
      </motion.div>
    </div>
  );
}
