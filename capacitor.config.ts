import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuração oficial do Capacitor 8 para o North Code Play.
 *
 * Decisões de arquitetura documentadas:
 * 1. A interface web é empacotada localmente a partir de `dist/` (gerado pelo Vite).
 * 2. `server.androidScheme = 'http'` e `server.cleartext = true`:
 *    Define a origem local da WebView como `http://localhost`. Isso garante que o
 *    elemento `<video>`, o HLS.js e as imagens `<img>` possam reproduzir transmissões
 *    e carregar capas tanto de servidores IPTV `http://` quanto `https://` sem
 *    bloqueio de Mixed Content pela WebView, mantendo a validação TLS padrão para HTTPS.
 * 3. `plugins.CapacitorHttp.enabled = false`:
 *    Mantém `fetch` e `XMLHttpRequest` globais intactos para o player HTML5/HLS.js.
 *    As consultas JSON da API Xtream utilizam `CapacitorHttp.get()` explicitamente
 *    através do adaptador `src/services/httpTransport.ts`.
 * 4. `plugins.SystemBars.insetsHandling = 'css'`:
 *    Delega os insets das barras do sistema no Android (Capacitor 8) para variáveis CSS
 *    (`--safe-area-inset-*`), preservando o layout em celulares e Android TV.
 */
const config: CapacitorConfig = {
  appId: 'com.northcode.play',
  appName: 'North Code Play',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    },
  },
};

export default config;
