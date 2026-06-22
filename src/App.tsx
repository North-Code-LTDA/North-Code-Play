/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import SpatialNavigation from 'spatial-navigation-js';
import { Login } from './pages/Login';
import { Home } from './pages/Home';

function SpatialNavigationManager() {
  const location = useLocation();

  useEffect(() => {
    SpatialNavigation.init();
    SpatialNavigation.add({
      selector: 'button, input, select, [tabindex="0"], .focusable-card'
    });
    SpatialNavigation.makeFocusable();
    SpatialNavigation.focus();
    
    return () => {
      SpatialNavigation.uninit();
    };
  }, []);

  useEffect(() => {
    setTimeout(() => {
      SpatialNavigation.makeFocusable();
      SpatialNavigation.focus();
    }, 100);
  }, [location]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      
      if (e.key === 'Enter') {
        const active = document.activeElement as HTMLElement;
        if (active && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') {
          active.click();
        }
      }

      if ((e.key === 'Backspace' && !isInput) || e.key === 'Escape') {
        e.preventDefault();
        const backBtn = document.querySelector('button[aria-label="Voltar"], .back-button, button:has(svg.lucide-arrow-left), button:has(svg.lucide-chevron-left), button:has(svg.lucide-x)') as HTMLElement;
        if (backBtn) {
          backBtn.click();
        } else {
          const buttons = document.querySelectorAll('button');
          const fallbackBackBtn = Array.from(buttons).find(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            return text.includes('voltar');
          });
          if (fallbackBackBtn) {
            (fallbackBackBtn as HTMLElement).click();
          } else {
            window.history.back();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}

export default function App() {
  return (
    <Router>
      <SpatialNavigationManager />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/home" element={<Home />} />
      </Routes>
    </Router>
  );
}
