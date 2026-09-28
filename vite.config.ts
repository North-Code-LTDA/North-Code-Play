import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const commit = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '04a1df5d2e4aeab43562343c9f4a72bad4cc3c9e';
  const buildTime = new Date().toISOString();

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_COMMIT__: JSON.stringify(commit),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
