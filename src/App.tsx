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
        // Verifica se o foco NÃO está em um input (se estiver digitando, deixa apagar o texto)
        if (document.activeElement?.tagName === 'INPUT') return;

        e.preventDefault();
        // Procura qualquer botão na tela que sirva para fechar/voltar e clica nele
        const backBtn = document.querySelector('button[aria-label="Voltar"], .lucide-arrow-left, .lucide-x, .lucide-chevron-left') as HTMLElement;
        // Sobe na árvore DOM para encontrar o botão real caso o ícone tenha sido pego
        const actualBtn = backBtn?.closest('button') || backBtn;
        if (actualBtn) actualBtn.click();
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
