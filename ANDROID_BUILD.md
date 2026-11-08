# Nota Técnica — Arquitetura em Camadas e Portabilidade Android (Capacitor 8)

## 1. Separação de Camadas

O **North Code Play** mantém sua base principal como aplicação web (**React 19 + TypeScript + Vite + Tailwind CSS 4**), isolando a camada de portabilidade Android:

- **Camada Web (`src/`, `index.html`, `vite.config.ts`)**:
  - Contém toda a interface, navegação espacial D-Pad, calibração contínua de escala (`50%` a `125%`) e reprodução de mídia.
  - O comando `npm run build` é dedicado exclusivamente à geração do bundle web em `dist/`.
  - Os adaptadores de runtime (`src/services/httpTransport.ts` e `src/navigation/capacitorBackAdapter.ts`) detectam o ambiente em tempo de execução, utilizando `fetch` e histórico web no navegador e ativando `CapacitorHttp` e `@capacitor/app` apenas quando executados no contêiner nativo.

- **Camada de Personalizações Android Versionada (`tooling/android/`)**:
  - `tooling/android/overlay/`: armazena exclusivamente os arquivos customizados do **North Code Play** (`MainActivity.java` com ajuste de WebView para Android TV, `AndroidManifest.xml` com suporte híbrido `LAUNCHER` e `LEANBACK_LAUNCHER`, `network_security_config.xml` para tráfego HTTP/HTTPS Xtream, `tv_banner.xml`, ícones adaptativos e página de aviso `webview_update_required.html`).
  - `tooling/android/patches/capacitor-android-8.6.0-http-diagnostics.patch`: patch mínimo para `HttpRequestHandler.java` na versão travada `@capacitor/android@8.6.0`, instrumentando a medição monotônica por etapa no Android (status e cabeçalhos, leitura e decodificação do corpo, interpretação JSON nativa, tempo total nativo, `Content-Length` do cabeçalho e caracteres lidos) apenas quando a coleta de abertura (P3.1/P3.2) está ativa.
  - `tooling/android/prepare-android.mjs`: script Node.js multiplataforma e idempotente que valida e aplica o patch nativo P3.2 em `@capacitor/android@8.6.0` (sem reaplicar quando já presente), gera a pasta `android/` via Capacitor quando ausente (ou reutiliza `android/` existente sem apagá-la), reaplica `tooling/android/overlay/` e os ícones de `src/assets/logo.png`, sincroniza `versionCode` / `versionName` com `package.json` e executa `cap sync android`.

- **Projeto Android Gerado (`/android/`)**:
  - Diretório derivado e ignorado no Git (`.gitignore`), gerado localmente sob demanda pelos scripts `npm run android:prepare`, `npm run android:sync` ou `npm run android:open`.

---

## 2. Requisitos Técnicos

- **Node.js**: `22.0.0` ou superior.
- **Capacitor**: linha `8.x` (`@capacitor/core`, `@capacitor/android`, `@capacitor/app`, `@capacitor/cli`).
- **Android Studio**: **Android Studio Otter 2025.2.1 ou posterior** (requisito oficial do Capacitor 8, com **JDK 21 / JBR 21** e **Android SDK Platform API 36**).

---

## 3. Comandos de Preparação

- `npm run build` — Compila exclusivamente a aplicação web em `dist/`.
- `npm run android:prepare` — Executa o build web, gera ou reutiliza `android/`, aplica as personalizações de `tooling/android/` e sincroniza os plugins Capacitor.
- `npm run android:sync` — Compila a aplicação web e sincroniza com `android/` preservando as customizações.
- `npm run android:open` — Garante o projeto `android/` preparado e o abre no Android Studio.
