import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Tres páginas: la web (/), la demo interactiva (/demo/) y la app de la estación (/app/).
// La psicóloga (IA) vive en server/psicologa.js; en desarrollo y vista previa se llega por proxy.
const toAI = { target: 'http://127.0.0.1:5193', rewrite: (p) => p.replace(/^\/(demo|app)/, '') };
const proxy = { '/demo/api/psicologa': toAI, '/demo/api/voz/sesion': toAI, '/app/api/psicologa': toAI, '/app/api/explicar': toAI, '/app/api/salud': toAI, '/app/api/espacio': toAI, '/app/api/voz/sesion': toAI };

export default defineConfig({
  server: { allowedHosts: true, proxy },
  preview: { allowedHosts: true, proxy },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        demo: resolve(import.meta.dirname, 'demo/index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        legal: resolve(import.meta.dirname, 'legal/index.html'),
      },
    },
  },
});
