/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import SpatialNavigation from 'spatial-navigation-js';
import { Login } from './pages/Login';
import { Home } from './pages/Home';

export default function App() {
  useEffect(() => {
    SpatialNavigation.init();
    SpatialNavigation.add({
      selector: 'button, input, a, [tabindex="0"]'
    });
    SpatialNavigation.makeFocusable();
    SpatialNavigation.focus();
    
    return () => {
      SpatialNavigation.uninit();
    };
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
