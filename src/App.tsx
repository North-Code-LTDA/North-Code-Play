/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Login } from './pages/Login';
import { Logo } from './components/Logo';
import { NavigationProvider } from './navigation';
import { readAutoLoginState } from './utils/accountUtils';

export type HomeModule = { default: React.ComponentType };

const defaultHomeLoader = (): Promise<HomeModule> =>
  import('./pages/Home').then((m) => ({ default: m.Home }));

let homeRouteLoadCount = 0;
let customHomeLoader: (() => Promise<HomeModule>) | null = null;

export function loadHomeRouteModule(): Promise<HomeModule> {
  homeRouteLoadCount += 1;
  const loader = customHomeLoader ?? defaultHomeLoader;
  return loader();
}

let LazyHome = lazy(loadHomeRouteModule);

export function getHomeRouteLoadCountForTest(): number {
  return homeRouteLoadCount;
}

export function resetHomeRouteLoadCountForTest(): void {
  homeRouteLoadCount = 0;
  LazyHome = lazy(loadHomeRouteModule);
}

export function setHomeRouteLoaderForTest(loader: (() => Promise<HomeModule>) | null): void {
  customHomeLoader = loader;
  LazyHome = lazy(loadHomeRouteModule);
}

export function HomeRouteLoadingFallback() {
  const playlistName = readAutoLoginState().credentials?.playlistName || 'sua lista';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carregando programação"
      data-route-loading="home"
      className="fixed inset-0 z-[100] bg-nc-bg/95 backdrop-blur-md nc-safe-overlay flex flex-col items-center justify-center text-center select-none"
    >
      <div className="relative mb-6">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/[0.04] border border-nc-border/60 flex items-center justify-center shadow-2xl backdrop-blur-sm">
          <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin motion-reduce:animate-none text-nc-primary" />
        </div>
        <div className="absolute inset-0 bg-white/[0.06] blur-2xl rounded-full pointer-events-none" />
      </div>

      <Logo className="mb-3 scale-105" />

      <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">
        Carregando sua programação
      </h2>
      <p className="text-sm text-nc-text-secondary mt-2 max-w-md">
        Sincronizando canais ao vivo, filmes e séries para {playlistName}...
      </p>

      <div className="w-full max-w-4xl mt-8 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 sm:gap-4 opacity-40 pointer-events-none">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="aspect-[2/3] rounded-xl bg-white/[0.03] border border-nc-border/40 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

export function AppRoutes({ HomeComponent }: { HomeComponent?: React.ComponentType }) {
  const ResolvedHome = HomeComponent ?? LazyHome;

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route
        path="/home"
        element={
          <Suspense fallback={<HomeRouteLoadingFallback />}>
            <ResolvedHome />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <NavigationProvider>
        <AppRoutes />
      </NavigationProvider>
    </Router>
  );
}

