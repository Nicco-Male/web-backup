# Deploy produzione `packages/web`

## 1) Build produzione

Eseguire la build Vite dalla cartella del progetto web:

```bash
cd packages/web
pnpm run build
```

L'output deve essere generato in `packages/web/dist`.

## 2) Web server: root su `dist`

### Nginx

Il file già presente in repo (`infra/default.conf`) usa:

```nginx
root /usr/share/nginx/html;
```

Nel container, `Containerfile` copia il contenuto di `packages/web/dist` in `/usr/share/nginx/html`.

### Caddy (esempio)

```caddyfile
:8080 {
  root * /var/www/meshtastic-web/dist
  file_server
  try_files {path} /index.html

  @assets path_regexp assets \.((js|css|png|jpg|jpeg|gif|ico|webp|avif|svg|ttf|otf|woff|woff2|map))$
  header @assets Cache-Control "public, max-age=7776000, immutable"
  header /index.html Cache-Control "no-cache"
}
```

### Apache (esempio)

```apache
DocumentRoot /var/www/meshtastic-web/dist

<Directory /var/www/meshtastic-web/dist>
  Options FollowSymLinks
  AllowOverride None
  Require all granted
</Directory>

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ /index.html [L]
</IfModule>

<FilesMatch "\.(js|css|png|jpg|jpeg|gif|ico|webp|avif|svg|ttf|otf|woff|woff2|map)$">
  Header set Cache-Control "public, max-age=7776000, immutable"
</FilesMatch>

<Files "index.html">
  Header set Cache-Control "no-cache"
</Files>
```

## 3) Verifica `index.html` build

Controllare che `dist/index.html` referenzi asset hashed (`index-<hash>.js`, `index-<hash>.css`) e **non** `src/index.tsx` o `src/index.css`.

Script di verifica rapido:

```bash
bash packages/web/infra/verify-production-build.sh
```

## 4) Deploy container

Il flusso previsto è già allineato a `packages/web/infra/Containerfile`:

- build front-end in `packages/web/dist`
- copia di `packages/web/dist` in `/usr/share/nginx/html`

Build immagine:

```bash
cd packages/web
pnpm run docker:build
```

## 5) Purge cache dopo redeploy

Dopo il deploy, invalidare almeno:

- browser hard refresh (Ctrl/Cmd+Shift+R)
- CDN cache purge per `index.html`
- eventuale reverse proxy cache purge

Questo evita che un `index.html` vecchio punti a bundle non più presenti.
