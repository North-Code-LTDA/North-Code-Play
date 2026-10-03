# Implantação Estática em VPS via Nginx (HTTP sem Conteúdo Misto)

O **North Code Play** foi reconvertido integralmente para uma aplicação SPA 100% estática e direta.
Todas as conexões para o catálogo Xtream, autenticação, EPG, capas e transmissões de vídeo (HLS / MP4) saem diretamente do navegador do cliente para o servidor do provedor IPTV.

## 1. Sequência de Publicação Manual no Servidor VPS

No servidor Ubuntu onde o repositório está clonado, execute rigorosamente a sequência de validação e compilação antes de atualizar os arquivos estáticos servidos pelo Nginx:

```bash
cd ~/NORHT_CODE_PLAY/North-Code-Play
git pull --ff-only
npm ci
npm run lint
npm test
GIT_COMMIT="$(git rev-parse HEAD)" npm run build
sudo rsync -a --delete dist/ /var/www/north-code-play/
```

> **Atenção:** A sincronização via `rsync` para `/var/www/north-code-play/` só deve ser realizada após o sucesso estrito de todas as etapas anteriores (`npm ci`, `npm run lint`, `npm test` e compilação do build de produção).

## 2. Configuração do Nginx na VPS

Para testar com provedores HTTP sem que o navegador bloqueie requisições por **Mixed Content** (conteúdo misto), hospede a aplicação em HTTP puro (porta 80).

Certifique-se de que as permissões de leitura do diretório estejam adequadas:
```bash
sudo chown -R www-data:www-data /var/www/north-code-play
```

Exemplo de configuração do site em `/etc/nginx/sites-available/north-code-play`:

```nginx
server {
    listen 80;
    server_name seudominio-ou-ip.com;

    root /var/www/north-code-play;
    index index.html;

    # Encaminhamento de rotas da SPA para index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache de arquivos estáticos
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Desativa logs desnecessários de favicon e robots
    location = /favicon.ico { log_not_found off; access_log off; }
    location = /robots.txt  { log_not_found off; access_log off; }
}
```

Ative o site e reinicie o Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/north-code-play /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 3. Considerações sobre CORS, Mídia e Favoritos

- **Isolamento de Favoritos por Conta:** Os favoritos são armazenados localmente no navegador (`localStorage`) por conta Xtream (tupla unívoca normalizada de servidor e usuário). A publicação estática não apaga o `localStorage` do cliente nem transfere favoritos entre contas ou dispositivos.
- **CORS do Provedor:** Como as requisições à API (`player_api.php`) e aos manifestos HLS (`.m3u8`) são feitas via `fetch`/`XMLHttpRequest` diretamente pelo navegador, o servidor do provedor IPTV precisa responder com o cabeçalho `Access-Control-Allow-Origin: *` (ou incluir a origem da aplicação).
- **Conteúdo Misto:** Se o provedor transmitir em HTTP puro, acessar a aplicação via HTTPS fará o navegador bloquear a mídia por segurança. Hospedar a aplicação em HTTP (porta 80) na VPS elimina o bloqueio de Mixed Content.
