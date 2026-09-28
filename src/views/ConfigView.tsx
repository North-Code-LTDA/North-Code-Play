import React, { useEffect, useState } from 'react';
import { Settings, User, Server, Calendar, Loader2, GitCommit, Film, Cpu, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { APP_VERSION, APP_COMMIT, APP_BUILD_TIME } from '../version';

export function ConfigView() {
  const { credentials } = useXtreamContext();
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverVersionInfo, setServerVersionInfo] = useState<{
    version?: string;
    commit?: string;
    ffmpegAvailable?: boolean;
    environment?: string;
  } | null>(null);

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

    // Query backend diagnostic endpoint
    fetch('/api/version')
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) setServerVersionInfo(data);
      })
      .catch(() => {
        // ignore
      });

    return () => {
      isMounted = false;
    };
  }, [credentials]);

  const formatDate = (expDate: string | number) => {
    if (!expDate || expDate === 'null') return 'Vitalícia / Indisponível';
    const timestamp = typeof expDate === 'string' ? parseInt(expDate, 10) : expDate;
    if (isNaN(timestamp)) return expDate;
    
    // Xtream typically uses seconds for timestamp
    const date = new Date(timestamp * 1000);
    if (date.getFullYear() > 2099) return 'Vitalícia';
    return `Sua conta expira em: ${date.toLocaleDateString('pt-BR')}`;
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-start p-6 md:p-12 overflow-y-auto custom-scrollbar">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-nc-bg-card border border-nc-border/50 rounded-2xl p-6 md:p-8 shadow-2xl mb-8"
      >
        <div className="flex items-center gap-4 mb-8 border-b border-nc-border/50 pb-6">
          <div className="p-3 bg-nc-bg-input rounded-xl text-nc-primary">
            <Settings className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Configurações & Diagnóstico</h2>
            <p className="text-nc-text-secondary text-sm">Gerencie suas credenciais e verifique a integridade do servidor</p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-nc-text-secondary">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-nc-primary" />
            <p>Carregando informações da conta...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-red-400 text-center">
            <p>{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-white mb-2">Informações da Conta</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-nc-bg-input rounded-xl p-5 border border-nc-border/50 flex items-start gap-4">
                <User className="w-6 h-6 text-nc-text-secondary mt-1 shrink-0" />
                <div className="overflow-hidden">
                  <p className="text-sm text-nc-text-secondary">Usuário Logado</p>
                  <p className="font-semibold text-white truncate text-lg mt-0.5">
                    {credentials?.username || 'Desconhecido'}
                  </p>
                </div>
              </div>

              <div className="bg-nc-bg-input rounded-xl p-5 border border-nc-border/50 flex items-start gap-4">
                <Server className="w-6 h-6 text-nc-text-secondary mt-1 shrink-0" />
                <div className="overflow-hidden w-full">
                  <p className="text-sm text-nc-text-secondary">URL do Servidor</p>
                  <p className="font-semibold text-white truncate text-lg mt-0.5 w-full">
                    {credentials?.serverUrl || 'Desconhecido'}
                  </p>
                </div>
              </div>

              <div className="bg-nc-bg-input rounded-xl p-5 border border-nc-border/50 flex items-start gap-4 md:col-span-2">
                <Calendar className="w-6 h-6 text-nc-text-secondary mt-1 shrink-0" />
                <div className="overflow-hidden">
                  <p className="text-sm text-nc-text-secondary">Validade da Assinatura</p>
                  <p className="font-semibold text-white truncate text-lg mt-0.5 text-nc-primary">
                    {formatDate(accountInfo?.exp_date)}
                  </p>
                </div>
              </div>
            </div>
            
            {accountInfo?.status && (
               <div className="mt-4 flex items-center gap-2 text-sm text-nc-text-secondary">
                  <span className="relative flex h-3 w-3">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${accountInfo.status === 'Active' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${accountInfo.status === 'Active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                  </span>
                 Status da Conta: <strong className="text-white ml-1">{accountInfo.status}</strong>
               </div>
            )}
          </div>
        )}

        {/* Build & Diagnostics Section */}
        <div className="mt-8 pt-6 border-t border-nc-border/50 space-y-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-nc-primary" /> Build & Diagnóstico do Servidor
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30">
              <span className="text-nc-text-secondary text-xs block mb-1 flex items-center gap-1.5">
                <GitCommit className="w-4 h-4 text-nc-primary" /> Commit Publicado
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
                <Cpu className="w-4 h-4 text-nc-primary" /> Suporte a FFmpeg no Servidor
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2.5 h-2.5 rounded-full ${serverVersionInfo?.ffmpegAvailable ? 'bg-green-400' : 'bg-amber-400'}`} />
                <span className="font-medium text-white text-xs">
                  {serverVersionInfo?.ffmpegAvailable === true 
                    ? "Disponível (Remux HLS ativo)" 
                    : serverVersionInfo?.ffmpegAvailable === false 
                    ? "Não detectado (Necessário p/ canais .ts)"
                    : "Verificando..."}
                </span>
              </div>
              <span className="text-gray-500 text-[11px] block mt-1">
                Permite conversão em tempo real de MPEG-TS para HLS
              </span>
            </div>

            <div className="bg-nc-bg-input/60 rounded-xl p-4 border border-nc-border/30 md:col-span-2">
              <span className="text-nc-text-secondary text-xs block mb-1 flex items-center gap-1.5">
                <Film className="w-4 h-4 text-nc-primary" /> Rotas Seguras HTTPS
              </span>
              <p className="text-gray-300 text-xs leading-relaxed">
                Todas as consultas de API passam por <code className="text-nc-primary bg-black/40 px-1 py-0.5 rounded">/api/xtream</code> e reprodução de canais, filmes, séries e capas por <code className="text-nc-primary bg-black/40 px-1 py-0.5 rounded">/api/media</code>.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
