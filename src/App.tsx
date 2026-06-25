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
    // Auto-focus sem necessidade de TAB
    setTimeout(() => {
      const startNode = document.querySelector('.sidebar-nav-item') as HTMLElement;
      if (startNode) startNode.focus();
    }, 500);

    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Escape') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        const backBtn = document.querySelector('button[aria-label="Voltar"], .lucide-arrow-left, .lucide-chevron-left, .lucide-x') as HTMLElement;
        const actualBtn = backBtn?.closest('button') || backBtn;
        if (actualBtn) {
          actualBtn.click();
        } else {
          const sidebar = document.querySelector('.sidebar-nav-item') as HTMLElement;
          if (sidebar) sidebar.focus();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
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
