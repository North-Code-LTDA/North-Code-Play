import React from 'react';
import { Settings } from 'lucide-react';
import { motion } from 'motion/react';

export function ConfigView() {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center p-12 text-center pt-24 md:pt-12 min-h-screen"
    >
      <Settings className="w-16 h-16 text-nc-text-secondary mb-4 opacity-50" />
      <h2 className="text-2xl font-semibold text-white mb-2">Configurações</h2>
      <p className="text-nc-text-secondary max-w-md mx-auto">Preferências do perfil, áudio, legendas e informações da conta serão exibidas aqui.</p>
    </motion.div>
  );
}
