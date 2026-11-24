/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { StartupLoadingScreen } from './components/StartupLoadingScreen';
import { NavigationProvider } from './navigation';

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
  return <StartupLoadingScreen dataRouteLoading="home" />;
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

