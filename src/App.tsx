/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { useEffect } from 'react';
import { initTvNavigation } from './utils/tvNavigation';

export default function App() {
  useEffect(() => {
    initTvNavigation();
    
    // Attempt to focus the first sidebar item if it exists
    setTimeout(() => {
      const firstFocusable = document.querySelector('[data-tv-zone="sidebar"] .tv-focus') as HTMLElement;
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }, 1000);
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
