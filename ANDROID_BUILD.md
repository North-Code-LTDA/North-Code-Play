# Guia Padrão de Geração do APK — North Code Play (Capacitor 8 + Android Studio)

Este documento descreve o procedimento oficial e reproduzível no **Windows** para compilar a interface web do **North Code Play**, sincronizar os arquivos com o **Capacitor 8** e gerar o APK (Debug ou Release assinado) para **Android TV, TV Box, celulares e tablets** usando o **Android Studio**.

---

## 1. Requisitos de Ambiente no Windows

1. **Node.js 22 LTS ou superior** (exigido pelo Capacitor CLI 8):
   - Verifique no terminal (PowerShell ou Prompt de Comando):
     ```powershell
     node -v
     npm -v
     ```
   - O comando `node -v` deve retornar `v22.x.x` ou superior.
2. **Android Studio (Ladybug / Meerkat ou superior)**:
   - Durante a instalação do Android Studio, mantenha marcados:
     - **Android SDK**
     - **Android SDK Platform** (API 36 / Android 16 ou superior, gerenciado automaticamente pelo Android Studio)
     - **Android SDK Build-Tools** e **Android SDK Command-line Tools**
   - **JDK 21**: o Android Studio já inclui o **JetBrains Runtime (JBR 21)** embutido (`File > Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK`).

---

## 2. Preparação Inicial Após Baixar o Projeto (ZIP ou Git)

1.Se você baixou o projeto como arquivo `.zip` pelo AI Studio ou GitHub:
   - Extraia todo o conteúdo do `.zip` para uma pasta local sem caracteres especiais no caminho (exemplo: `C:\Projetos\North-Code-Play`).
2. Abra o **PowerShell** ou **Terminal** na pasta raiz do projeto (onde está o arquivo `package.json`) e instale as dependências:
   ```powershell
   npm install
   ```

---

## 3. Compilar a Interface Web e Sincronizar com o Android

Sempre que alterar o código React/TypeScript/CSS ou preparar uma nova versão:

1. Execute o comando integrado de preparação Android:
   ```powershell
   npm run android:prepare
   ```
   *(Esse comando executa internamente `npm run build` para gerar a pasta `dist/` e em seguida `npx cap sync android` para copiar os arquivos empacotados para `android/app/src/main/assets/public`).*

   Se preferir rodar cada etapa separadamente:
   ```powershell
   npm run build
   npm run cap:sync
   ```

---

## 4. Abrir o Projeto no Android Studio

1. Para abrir diretamente pelo terminal:
   ```powershell
   npm run android:open
   ```
   Ou abra o **Android Studio** manualmente, clique em **Open** e selecione a subpasta **`android`** dentro da pasta do projeto (`C:\Projetos\North-Code-Play\android`).
2. Aguarde o término do **Gradle Sync** na barra inferior do Android Studio (na primeira abertura, o Gradle fará o download automático das dependências do Android SDK).

---

## 5. Gerar APK de Teste (Debug APK)

Ideal para testes rápidos em TV Box, Android TV, celular ou emulador via ADB / pendrive:

1. No menu superior do Android Studio, acesse:
   **`Build > Generate App Bundles or APKs > Generate APKs`**
2. Aguarde a conclusão do build. Uma notificação aparecerá no canto inferior direito (**`Build Completed`**).
3. Clique em **Locate** na notificação ou acesse diretamente o arquivo gerado em:
   ```text
   android\app\build\outputs\apk\debug\app-debug.apk
   ```

---

## 6. Gerar APK de Distribuição Assinado (Release APK)

Para distribuir o aplicativo aos clientes e permitir que novas versões atualizem o aplicativo já instalado sem erro de conflito:

1. No menu superior do Android Studio, acesse:
   **`Build > Generate Signed App Bundle or APK...`**
2. Selecione a opção **`APK`** e clique em **`Next`**.
3. Na tela de **Key store path**:
   - **Primeira vez**: clique em **`Create new...`**, escolha um local seguro para salvar o arquivo `.jks` (ex.: `northcode-release-key.jks`), defina as senhas do Keystore e da Key (`key0`), preencha os dados da organização (**North Code LTDA**) e confirme.
   - **Próximas versões**: clique em **`Choose existing...`** e selecione sempre o **mesmo arquivo `.jks`** criado anteriormente.
4. Clique em **`Next`**, selecione a variante **`release`** e clique em **`Create`**.
5. O APK assinado estará disponível em:
   ```text
   android\app\build\outputs\apk\release\app-release.apk
   ```

---

## 7. Cuidados Essenciais para Atualizações Sem Conflito no Android

Para que o usuário possa instalar uma nova versão do APK por cima da anterior (preservando login salvo, favoritos, histórico e calibração de escala da TV):

1. **Nunca altere o `applicationId` / `appId`**:
   - Mantenha sempre `com.northcode.play` em `capacitor.config.ts` e `android/app/build.gradle`.
2. **Use sempre a mesma chave de assinatura (Keystore `.jks`)**:
   - O Android exige que toda atualização tenha exatamente a mesma assinatura criptográfica do APK instalado anteriormente. Faça backup seguro do seu arquivo `.jks` e das senhas.
3. **Incremente `versionCode` e `versionName` a cada lançamento**:
   - No arquivo `android/app/build.gradle`, aumente o número inteiro `versionCode` (ex.: de `10300` para `10301`) e atualize `versionName` (ex.: `"1.3.1"`), mantendo sincronizado com o `version` do `package.json`.
4. **Reutilização da pasta `android/`**:
   - A pasta `android/` já faz parte do repositório e **deve ser reutilizada** nas próximas entregas. Não apague a pasta `android/`; basta rodar `npm run android:prepare` para atualizar os arquivos web dentro do projeto Android existente.
