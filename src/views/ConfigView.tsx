import React, { useEffect, useState } from 'react';
import { Settings, User, Server, Calendar, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useXtreamContext } from '../context/XtreamContext';
import { XtreamService } from '../services/xtreamService';

export function ConfigView() {
  const { credentials } = useXtreamContext();
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="w-full h-full flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-nc-bg-card border border-nc-border/50 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex items-center gap-4 mb-8 border-b border-nc-border/50 pb-6">
          <div className="p-3 bg-nc-bg-input rounded-xl text-nc-primary">
            <Settings className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Configurações</h2>
            <p className="text-nc-text-secondary">Gerencie suas informações da conta</p>
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
            <h3 className="text-lg font-medium text-white mb-4">Informações da Conta</h3>
            
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
               <div className="mt-6 flex items-center gap-2 text-sm text-nc-text-secondary">
                  <span className="relative flex h-3 w-3">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${accountInfo.status === 'Active' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${accountInfo.status === 'Active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                  </span>
                 Status da Conta: <strong className="text-white ml-1">{accountInfo.status}</strong>
               </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
