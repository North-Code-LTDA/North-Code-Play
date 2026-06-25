/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Login } from './pages/Login';
import { Home } from './pages/Home';

export default function App() {
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Escape') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();

        // 1. Tenta fechar modais/filmes abertos (Busca por textos ou ícones)
        const buttons = Array.from(document.querySelectorAll('button'));
        const backBtn = buttons.find(btn => 
          btn.textContent?.toLowerCase().includes('voltar') || 
          btn.innerHTML.includes('lucide-arrow-left') || 
          btn.innerHTML.includes('lucide-chevron-left') || 
          btn.innerHTML.includes('lucide-x')
        ) as HTMLElement;

        if (backBtn) {
          backBtn.click();
        } else {
          // 2. ZONA DE MENU: Se não há botão voltar, foca no menu lateral (Sidebar)
          // Ajuste o seletor '.sidebar' para a classe correta do menu lateral do seu layout principal
          const sidebarLink = document.querySelector('aside a, aside button, nav a, .sidebar a') as HTMLElement;
          if (sidebarLink) sidebarLink.focus();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/home" element={<Home />} />
      </Routes>
    </Router>
  );
}
