# Hospedagem Web Estática em VPS Ubuntu com Nginx (HTTP)

## 1. Arquitetura Atual da Aplicação

- **Aplicação SPA estática**: React 19, TypeScript, Vite e Tailwind CSS 4, com dependências gerenciadas oficialmente por **npm** (`package.json` + `package-lock.json`).
- **Fonte oficial**: repositório GitHub `North-Code-LTDA/North-Code-Play` (branch `main`).
- **Comunicação direta com provedores Xtream Codes**: autenticação, catálogos, EPG, capas e transmissões de vídeo (HLS / MP4) saem diretamente do cliente para o servidor IPTV, sem backend intermediário.
- **Infraestrutura web em HTTP**: hospedagem estática direta em VPS Ubuntu com **Nginx em HTTP (porta 80)**, sem implantação de HTTPS neste momento, para evitar bloqueios de *Mixed Content* com provedores IPTV que operam em HTTP.
- **Infraestrutura legada removida**: a plataforma Render (`render.yaml`) e o empacotamento Docker (`Dockerfile`, `.dockerignore`) não são mais utilizados pelo projeto.

---

## 2. Procedimento Manual Conhecido

Na VPS Ubuntu onde o repositório oficial do GitHub estiver clonado, a sequência manual de atualização do bundle estático é:

```bash
cd <diretorio-do-clone>/North-Code-Play
git pull --ff-only
npm ci
npm run lint
GIT_COMMIT="$(git rev-parse HEAD)" npm run build
sudo rsync -a --delete dist/ <diretorio-publico-nginx>/
```

> **Notas operacionais:**
> - Substitua `<diretorio-do-clone>` e `<diretorio-publico-nginx>` (por exemplo, `/var/www/north-code-play/`) pelos caminhos reais confirmados na auditoria da VPS.
> - A sincronização para o diretório servido pelo Nginx só deve ocorrer após a conclusão bem-sucedida de `npm ci`, `npm run lint` e `npm run build`.
> - **Não é recomendada** a execução automática da suíte completa de testes (`npm test`) em todos os deploys; execute testes direcionados apenas sob demanda em desenvolvimento ou homologação.

---

## 3. Referência Técnica do Arquivo `nginx.conf` (Origem Docker)

O arquivo `nginx.conf` preservado na raiz do repositório foi **originalmente criado para o antigo ambiente Docker** (utilizando `root /usr/share/nginx/html;`).

- **Não deve ser aplicado automaticamente à VPS.**
- Seu conteúdo permanece no repositório **exclusivamente como referência técnica** para duas diretrizes da futura configuração definitiva do Nginx na VPS:
  1. Roteamento SPA (`try_files $uri $uri/ /index.html;`) para evitar erro 404 em rotas internas como `/home`.
  2. Política de cache para ativos estáticos versionados (`js`, `css`, imagens e fontes).

Exemplo conceitual de bloco de servidor Nginx para hospedagem estática direta em HTTP (sujeito à auditoria do ambiente real da VPS antes de qualquer aplicação):

```nginx
server {
    listen 80;
    server_name <dominio-ou-ip-da-vps>;

    root <diretorio-publico-nginx>;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location = /favicon.ico { log_not_found off; access_log off; }
    location = /robots.txt  { log_not_found off; access_log off; }
}
```

---

## 4. Configurações que Ainda Dependem de Auditoria da VPS

Antes de padronizar a configuração final do servidor, os seguintes itens precisam ser verificados diretamente na VPS em produção:

- Caminho real do repositório clonado e do diretório raiz (`root`) servido pelo Nginx.
- Nome e conteúdo atuais do vhost em `/etc/nginx/sites-available/` e link ativo em `/etc/nginx/sites-enabled/`.
- Valor efetivo de `server_name` (IP ou domínio) e portas em uso.
- Permissões e proprietário do diretório web (ex.: `www-data:www-data`).
- Regras existentes de logs, compressão (`gzip`), cabeçalhos ou cache para `index.html` vs. arquivos em `assets/`.
- Procedimento seguro de validação (`sudo nginx -t`) e recarga (`sudo systemctl reload nginx`) sem impactar outros serviços hospedados na mesma máquina.

---

## 5. Futuras Ferramentas de Provisionamento e Deploy (Não Implementadas)

Este repositório **ainda não possui** scripts automatizados de provisionamento de servidor, geração de vhost Nginx ou pipeline de deploy remoto para a VPS.

Quaisquer ferramentas ou scripts de automação para a VPS serão especificados e implementados em uma etapa futura, somente após a auditoria do servidor real.

---

## 6. Considerações sobre CORS, Mídia e Favoritos

- **Isolamento de Favoritos por Conta**: os favoritos e o histórico permanecem armazenados localmente no navegador (`localStorage`) por conta Xtream (tupla normalizada de servidor e usuário). A atualização dos arquivos estáticos na VPS não apaga os dados locais do usuário.
- **CORS do Provedor**: como as chamadas à API Xtream (`player_api.php`) e aos manifestos HLS (`.m3u8`) ocorrem diretamente do navegador para o provedor IPTV, o servidor do provedor precisa permitir acesso cross-origin (`Access-Control-Allow-Origin`).
- **Mixed Content**: quando o provedor IPTV transmite em HTTP puro, servir a aplicação web em HTTP (porta 80) evita o bloqueio de mídia pelo navegador.
