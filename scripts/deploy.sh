#!/bin/sh
# Publica una versión nueva de xpaze.es sin cortes: compila aparte y cambia la carpeta de golpe.
# El servidor web (Caddy, ver Caddyfile.example) sirve la carpeta dist/ de este proyecto.
set -e
cd "$(dirname "$0")/.."
npm test >/dev/null
npx vite build --outDir .dist-next --emptyOutDir
# se conservan los ficheros con hash de la versión anterior: una página ya abierta (o guardada en
# el navegador) sigue encontrando su código aunque se publique otra versión
[ -d dist/assets ] && cp -pn dist/assets/* .dist-next/assets/ 2>/dev/null || true
# y se limpian los de hace más de 7 días
find .dist-next/assets -type f -mtime +7 -delete 2>/dev/null || true
rm -rf .dist-old
[ -d dist ] && mv dist .dist-old
mv .dist-next dist
rm -rf .dist-old
curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:5190/ && echo "Publicado y respondiendo en :5190"
