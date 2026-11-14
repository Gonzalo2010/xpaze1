#!/bin/sh
# Publica una versión nueva de xpaze.es sin cortes: compila aparte y cambia la carpeta de golpe.
# El servidor web (Caddy, ver Caddyfile.example) sirve la carpeta dist/ de este proyecto.
set -e
cd "$(dirname "$0")/.."
npm test >/dev/null
npx vite build --outDir .dist-next --emptyOutDir
rm -rf .dist-old
[ -d dist ] && mv dist .dist-old
mv .dist-next dist
rm -rf .dist-old
curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:5190/ && echo "Publicado y respondiendo en :5190"
