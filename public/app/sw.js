// Service worker de la app XPaze: funciona sin conexión una vez abierta.
// Navegación: red primero (para recibir versiones nuevas) y copia guardada si no hay red.
// Ficheros con hash de /assets/ e iconos: copia guardada primero.
const CACHE = 'xpaze-app-v1';
const SHELL = ['/app/', '/app/manifest.webmanifest', '/app/icon-192.png', '/logo-mark-dark.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('/app/', copy));
      return res;
    }).catch(() => caches.match('/app/')));
    return;
  }
  const cacheable = url.origin === location.origin
    ? url.pathname.startsWith('/assets/') || url.pathname.startsWith('/app/') || url.pathname.endsWith('.png')
    : url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (!cacheable) return;
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
