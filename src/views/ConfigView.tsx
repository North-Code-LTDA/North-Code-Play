import React, { useEffect, useState } from 'react';
import { Settings, User, Server, Calendar, Loader2, GitCommit, Globe, Radio, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';
import { APP_VERSION, APP_COMMIT } from '../version';

export function ConfigView() {
  const { credentials } = useXtreamContext();
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (credentials) {
      XtreamService.authenticate(credentials)
        .then((data) => {
          if (isMounted) {
            setAccountInfo(data.user_info);
            setServerInfo(data.server_info);
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
            <p className="text-nc-text-secondary text-sm">
              Gerencie suas credenciais e verifique os detalhes de conexão direta com o provedor
            </p>
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
        <div className="mt-8 pt-6 border-t border-nc-border/50 space-y-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-nc-primary" /> Arquitetura & Diagnóstico
          </h3>

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
  );
}
