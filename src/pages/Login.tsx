import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { XtreamService } from '../services/xtreamService';

const AVATAR_OPTIONS = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Jasper',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Peanut',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Cleo',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Mittens',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Boots',
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
  
  const navigate = useNavigate();

  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setServerUrl(value);

    // Try to parse an M3U link automatically
    try {
      if (value.includes('username=') && value.includes('password=')) {
        const urlObj = new URL(value);
        const urlUser = urlObj.searchParams.get("username");
        const urlPass = urlObj.searchParams.get("password");
        if (urlUser && urlPass) {
          setUsername(urlUser);
          setPassword(urlPass);
          setServerUrl(`${urlObj.protocol}//${urlObj.host}${urlObj.port ? `:${urlObj.port}` : ''}`);
        }
      }
    } catch (err) {
      // Ignore invalid URLs
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const credentials = {
      playlistName: playlistName.trim() || 'Minha Lista',
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      password,
      avatar,
    };

    try {
      // Validate credentials against Xtream server
      await XtreamService.authenticate(credentials);
      
      // If validation succeeds, save and redirect
      localStorage.setItem('northcode_tv_credentials', JSON.stringify(credentials));
      navigate('/home');
    } catch (err: any) {
      setError(err.message || 'Falha na autenticação. Verifique os dados inseridos.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-nc-bg">
      {/* Background glow effect for a premium feel */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-white/[0.02] blur-[120px] rounded-full pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[440px] z-10"
      >
        <div className="flex justify-center mb-10">
          <Logo className="scale-110" />
        </div>

        <div className="bg-nc-bg-card border border-nc-border rounded-2xl p-8 sm:p-10 shadow-2xl backdrop-blur-sm">
          <h1 className="text-2xl font-semibold mb-8 text-center text-nc-text-primary">
            Entrar
          </h1>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* List Name & Avatar Selector */}
            <div className="space-y-1.5 relative">
              <label htmlFor="playlistName" className="text-sm font-medium text-nc-text-secondary block">
                Nome da Lista <span className="text-nc-text-secondary/50 text-xs font-normal">(Opcional)</span>
              </label>
              <div className="flex gap-3 items-center">
                <button
                  type="button"
                  onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                  className="w-[50px] h-[50px] rounded-full overflow-hidden shrink-0 border-2 border-nc-border hover:border-nc-primary transition-colors focus:outline-none bg-black/20"
                >
                  <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                </button>
                <input
                  id="playlistName"
                  type="text"
                  placeholder="Ex: Minha TV"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="flex-1 min-w-0 bg-nc-bg-input border border-nc-border rounded-xl px-4 py-3 text-nc-text-primary placeholder:text-nc-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-nc-primary focus:border-nc-primary transition-all duration-200"
                />
              </div>

              <AnimatePresence>
                {showAvatarPicker && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    className="absolute top-[85px] left-0 z-20 bg-nc-bg border border-nc-border rounded-xl p-3 shadow-2xl w-full"
                  >
                    <p className="text-xs font-medium text-nc-text-secondary mb-3">Escolha um Ícone</p>
                    <div className="grid grid-cols-4 gap-3">
                      {AVATAR_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => { setAvatar(opt); setShowAvatarPicker(false); }}
                          className={`rounded-full overflow-hidden border-2 transition-all duration-200 ${avatar === opt ? 'border-nc-primary scale-110 shadow-[0_0_15px_rgba(var(--nc-primary),0.3)]' : 'border-transparent hover:border-white/20 hover:bg-white/5'}`}
                        >
                          <img src={opt} alt="Avatar option" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Server URL */}
            <div className="space-y-1.5">
              <label htmlFor="serverUrl" className="text-sm font-medium text-nc-text-secondary block">
                URL do Servidor
              </label>
              <input
                id="serverUrl"
                type="url"
                required
                placeholder="http://exemplo.com:8080 ou link M3U"
                value={serverUrl}
                onChange={handleServerUrlChange}
                className="w-full bg-nc-bg-input border border-nc-border rounded-xl px-4 py-3 text-nc-text-primary placeholder:text-nc-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-nc-primary focus:border-nc-primary transition-all duration-200"
              />
            </div>

            {/* Username */}
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-sm font-medium text-nc-text-secondary block">
                Usuário
              </label>
              <input
                id="username"
                type="text"
                required
                placeholder="Seu usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-nc-bg-input border border-nc-border rounded-xl px-4 py-3 text-nc-text-primary placeholder:text-nc-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-nc-primary focus:border-nc-primary transition-all duration-200"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-nc-text-secondary block">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-nc-bg-input border border-nc-border rounded-xl py-3 pl-4 pr-12 text-nc-text-primary placeholder:text-nc-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-nc-primary focus:border-nc-primary transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-nc-text-secondary hover:text-nc-text-primary transition-colors p-1"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl">
                <p className="text-red-400 text-sm text-center font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !serverUrl || !username || !password}
              className="w-full bg-nc-primary text-black font-semibold rounded-xl py-3.5 mt-4 hover:bg-nc-primary-hover active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all duration-200 flex items-center justify-center"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-black" />
              ) : (
                "Entrar"
              )}
            </button>
          </form>

          <p className="text-center text-nc-text-secondary text-sm mt-8">
            Plataforma North Code Play
          </p>
        </div>
      </motion.div>
    </div>
  );
}
