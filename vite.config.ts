import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

function resolveBuildCommit(): string {
  const envCommit =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.VITE_APP_COMMIT ||
    process.env.COMMIT_SHA;

  if (envCommit && envCommit.trim()) {
    return envCommit.trim();
  }

  try {
    const gitDir = path.resolve(__dirname, '.git');
    if (fs.existsSync(gitDir)) {
      const gitSha = execSync('git rev-parse HEAD', {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (gitSha) {
        return gitSha;
      }
    }
  } catch {
    // Sem metadados Git disponíveis (ex.: código extraído de ZIP)
  }

  return 'local-build';
}

export default defineConfig(() => {
  const commit = resolveBuildCommit();
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
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
    },
  };
});
