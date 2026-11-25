# Compilação Android e Portabilidade (Capacitor 8)

## 1. Fonte Oficial e Gerenciador de Dependências

- **Repositório oficial**: `North-Code-LTDA/North-Code-Play` (branch `main`). Utilize sempre o código-fonte clonado ou atualizado diretamente do GitHub para compilação e distribuição, evitando divergências presentes em exportações ZIP avulsas (como ausência de `package-lock.json`).
- **Gerenciador oficial**: `npm` (`package.json` e `package-lock.json`). Para instalação reprodutível das dependências, utilize `npm ci`.

---

## 2. Arquitetura em Camadas

O **North Code Play** mantém sua base principal como aplicação web (**React 19 + TypeScript + Vite + Tailwind CSS 4**), isolando a camada de portabilidade Android:

- **Camada Web (`src/`, `index.html`, `vite.config.ts`, `capacitor.config.ts`)**:
  - Contém toda a interface, navegação espacial D-Pad, calibração contínua de escala (`50%` a `125%`, padrão TV `90%`) e reprodução de mídia.
  - O comando `npm run build` gera exclusivamente o bundle web estático em `dist/`.
  - Os adaptadores de runtime (`src/services/httpTransport.ts`, `src/services/androidCatalogFileAdapter.ts`, `src/services/androidImageCache.ts` e `src/navigation/capacitorBackAdapter.ts`) detectam o ambiente em tempo de execução, utilizando `fetch` e histórico web no navegador e ativando `CapacitorHttp`, `CatalogFileTransfer`, `ImageDiskCache` e `@capacitor/app` apenas quando executados no contêiner nativo Android.

- **Camada de Personalizações Android Versionada (`tooling/android/`)**:
  - `tooling/android/overlay/`: armazena exclusivamente os arquivos nativos customizados do **North Code Play**:
    - `MainActivity.java` (ajustes de WebView para Android TV e registro de `CatalogFileTransferPlugin` e `ImageDiskCachePlugin`);
    - `CatalogFileTransferPlugin.java` (gravação em fluxo de catálogos grandes em `<cacheDir>/nc_catalog_transfers/` sem tráfego do corpo JSON pela ponte);
    - `ImageDiskCachePlugin.java` (cache persistente de imagens em disco em `nc_image_cache`);
    - `AndroidManifest.xml` (suporte híbrido `LAUNCHER` e `LEANBACK_LAUNCHER`);
    - `network_security_config.xml` (tráfego HTTP/HTTPS direto com provedores Xtream Codes);
    - `tv_banner.xml`, ícones adaptativos e página local `webview_update_required.html`.
  - `tooling/android/prepare-android.mjs`: script Node.js multiplataforma e idempotente que valida a integridade limpa de `@capacitor/android@8.6.0`, gera o diretório `android/` via Capacitor quando ausente (ou reutiliza um diretório `android/` existente sem apagá-lo), reaplica `tooling/android/overlay/` e os ícones oficiais gerados a partir de `src/assets/logo.png`, sincroniza `versionName` (`1.3.0`) e `versionCode` (`10300`) a partir do `package.json` e executa `cap sync android`.

- **Projeto Android Gerado (`/android/`)**:
  - Diretório derivado e ignorado no Git (`.gitignore`), gerado localmente sob demanda pelos scripts de preparação Android.

---

## 3. Requisitos Técnicos

- **Node.js**: `22.0.0` ou superior (definido em `package.json` -> `engines.node`) com **npm**.
- **Capacitor**: linha `8.x` (`@capacitor/core`, `@capacitor/app`, `@capacitor/cli` em `^8.0.0` e `@capacitor/android` travado em `8.6.0`).
- **Java / Android Studio**: **JDK 21 / JBR 21**, **Android SDK Platform API 36** e **Android Studio Otter 2025.2.1 ou posterior** (requisito oficial do Capacitor 8).

---

## 4. Comandos Reais de Preparação e Sincronização

Execute os comandos abaixo na raiz do repositório obtido do GitHub:

- `npm ci` — Instala as dependências exatas registradas em `package-lock.json`.
- `npm run build` — Compila exclusivamente a aplicação web em `dist/`.
- `npm run android:prepare` — Executa `npm run build`, gera ou reutiliza `android/`, aplica `tooling/android/overlay/`, gera os ícones a partir de `src/assets/logo.png`, sincroniza versão/versionCode e executa `cap sync android`.
- `npm run android:sync` — Executa `npm run build` e sincroniza `dist/` e plugins com `android/` preservando todas as customizações.
- `npm run cap:sync` — Reexecuta `tooling/android/prepare-android.mjs --skip-web-build` reaproveitando um `dist/` já compilado.
- `npm run android:open` — Garante o projeto `android/` preparado (reaproveitando `dist/`) e o abre no Android Studio.

---

## 5. Compilação do APK

Após preparar o projeto `android/` com `npm run android:prepare` (ou `npm run android:sync`), a geração final do APK/AAB é realizada pelo **Android Studio** (Gradle/JDK 21) ou pela ferramenta externa Windows utilizada no ambiente de build do projeto.
