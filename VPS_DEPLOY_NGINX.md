# Implantação Estática em VPS via Nginx (HTTP sem Conteúdo Misto)

O **North Code Play** foi reconvertido integralmente para uma aplicação SPA 100% estática e direta.
Todas as conexões para o catálogo Xtream, autenticação, EPG, capas e transmissões de vídeo (HLS / MP4) saem diretamente do navegador do cliente para o servidor do provedor IPTV.

## 1. Gerar os arquivos estáticos

No seu ambiente local ou CI/CD:
```bash
npm ci
npm run build
```
O resultado será gerado na pasta `dist/`.

## 2. Configuração do Nginx na VPS

Para testar com provedores HTTP sem que o navegador bloqueie requisições por **Mixed Content** (conteúdo misto), hospede a aplicação em HTTP puro (porta 80).

Copie o conteúdo de `dist/` para `/var/www/north-code-play`:
```bash
sudo mkdir -p /var/www/north-code-play
sudo cp -r dist/* /var/www/north-code-play/
sudo chown -R www-data:www-data /var/www/north-code-play
```

Crie o arquivo de configuração do site em `/etc/nginx/sites-available/north-code-play`:

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

## 3. Considerações sobre CORS e Conectividade

- **CORS do Provedor:** Como as requisições à API (`player_api.php`) e aos manifestos HLS (`.m3u8`) são feitas via `fetch`/`XMLHttpRequest` diretamente pelo navegador, o servidor do provedor IPTV precisa responder com o cabeçalho `Access-Control-Allow-Origin: *` (ou incluir a origem da aplicação).
- **Conteúdo Misto:** Se o provedor transmitir em HTTP puro, acessar a aplicação via HTTPS fará o navegador bloquear a mídia por segurança. Hospedar a aplicação em HTTP (porta 80) na VPS elimina o bloqueio de Mixed Content.
