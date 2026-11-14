# XPaze — web v2

Web nueva de XPaze, hecha desde cero. Clara, ordenada en 8 capítulos y con efectos ligados al scroll. Incluye la demo interactiva en `/demo/`.

## Comandos

```sh
npm run dev       # desarrollo en :5192
npm run build     # compila a dist/
npm run preview   # sirve dist/ en :5192
npm test          # 61 tests del motor de análisis y del módulo Mente
```

## Estructura de la página

| # | Capítulo | Efecto |
|---|---|---|
| — | Hero | Título por líneas, estación 3D que gira con el scroll (en móvil, imagen fija) |
| 01 | El problema | Nueve señales dispersas que se juntan en «una sola lectura» (fijado) |
| 02 | La idea | Interactivo: el mismo 108 ppm en tres contextos |
| 03 | El sistema | Carrusel horizontal fijado: estación, reloj, app y el gesto |
| 04 | Tu normal | Gráfica de 58 días que se dibuja con el scroll y la alerta explicada |
| 05 | La mente | Rejilla, test de reacción y respiración guiada que funcionan de verdad |
| 06 | Autonomía | Retardo real Tierra–Marte calculado para hoy (`src/mars.js`) |
| 07 | Por dentro | Desmontaje 3D de la estación en 8 pasos, componentes y cómo piensa |
| 08 | Prototipo | Lo que funciona hoy y lo que está en integración, usos en la Tierra |

## Ficheros

- `index.html`: todo el contenido (solo español por ahora).
- `src/style.css`: estilos. Los colores están como variables en `:root`.
- `src/main.js`: Lenis (scroll suave), GSAP ScrollTrigger y las interacciones.
- `src/stage.js`: lienzo 3D fijo. `src/station.js`: modelo real y desmontaje.
- `src/mars.js`: posición de Tierra y Marte a partir de sus elementos orbitales medios.
- `demo/` y `src/demo/`: la demo (copiada de la v1, sin cambios salvo el aviso).
- `sensors/`: puente Python para los sensores reales en la Raspberry Pi.

## Notas

- La web no menciona ningún concurso ni organismo.
- Respeta `prefers-reduced-motion`: sin scroll suave ni animaciones, con todo visible.
- Si no hay WebGL, se muestra la imagen fija y los pasos del desmontaje como lista.

## App de la estación (`/app/`, PWA)

App para el móvil. Al abrirla pregunta si conectar con la **estación física por Bluetooth** o usar una **estación simulada**.

- `src/app/protocol.js`: protocolo BLE versión 1. Es el mismo que `sensors/ble_protocol.py`; si se cambia uno, hay que cambiar el otro.
- `src/app/link.js`: dos conexiones con la misma interfaz:
  - `BleLink`: Web Bluetooth. Se reconecta sola si se corta y recuerda el dispositivo.
  - `SimLink`: genera los mismos paquetes binarios que la estación real.
- `src/app/assess.js`: valora cada chequeo. Usa la ficha de tripulación hasta tener 5 chequeos propios; después, la línea base personal (mediana + MAD).
- `src/app/main.js`: pantallas de elegir, conectando, en directo (onda de pulso, cabina, reloj), chequeo de 30 s, resultado e historial. El historial se guarda en `localStorage`.
- `public/app/`: manifiesto, service worker (funciona sin conexión) e iconos.

Web Bluetooth necesita **https** y Chrome (Android u ordenador). En iPhone solo está disponible la estación simulada.
En la Raspberry, el puente se arranca con `--ble` para anunciarse como «XPaze Station».

Tests: `npm test` (protocolo con paquetes reales de la Pi, valoración y simulador) y `python3 -m unittest discover -s tests/sensors`.

## Mente y psicóloga (IA)

- `src/demo/psych/index.js`: la «fase 2» que conecta el motor (`psych/engine/`) con la demo. Tiene siete pestañas: Resumen (estado, cambios sostenidos, contramedidas, índice fisiológico y evolución por métrica), Hoy (registro diario), Prueba de reacción, Respirar, Diario, Psicóloga y Privacidad. Los datos se guardan en `state.psych[id]`. Si una persona no tiene registro, se crea un historial simulado de los días anteriores para que haya línea base.
- `src/demo/psych/chat.js` y `server/psicologa.js`: la psicóloga de a bordo.
  - Usa Claude Opus 5.5 (SDK oficial) con esfuerzo bajo, streaming y respaldo automático si el modelo rechaza la petición.
  - Recibe el estado de Mente y las métricas de hoy, nunca el diario. No guarda las conversaciones.
  - Limita a 30 mensajes por IP cada 10 min y 1500 al día.
  - Ante un riesgo, siempre muestra el 112 y el 024.
  - `PSICOLOGA_PROVIDER=ollama` la cambia a un modelo local.
- Servicios systemd: `xpaze-psicologa` (127.0.0.1:5193, lee `.env` con `ANTHROPIC_API_KEY`) y `xpaze2-preview` (:5192, hace de proxy de `/api/psicologa`). Para publicar en producción, añadir en Caddy `reverse_proxy /api/psicologa* 127.0.0.1:5193`.

## Chequeo guiado, semáforo e IA (app `/app/`)

- `src/app/clinical.js` es la fuente única de los umbrales (NEWS2, ACC/AHA, ADA, PHQ-2, AASM y NASA-STD-3001), de los pasos y del «por qué» de cada medición, de los entornos (tránsito, estación, base lunar, rover) y de la guía de actuación. La tabla con fuentes y riesgos del HRP está en `docs/medical-thresholds.md` (inglés).
- El chequeo tiene 5 pasos: pulso y SpO₂ (sensor, o a mano si falla), tensión, glucosa, ánimo y sueño (PHQ-2) y señales de alarma. **El semáforo lo deciden los umbrales**; la IA (`/app/api/explicar`) solo lo explica, y la psicóloga (`/app/api/psicologa`) acompaña.
- Conexiones: estación simulada, Bluetooth (`--ble`) y **WiFi** (`bridge.py --lan`: la Pi sirve la app y emite `/api/stream` por SSE; con `--ai URL` reenvía las peticiones de IA).
- Psicóloga: usa las estrategias de ESConv y el estilo de la entrevista motivacional. Evaluación: `node --env-file=.env scripts/eval-psicologa.mjs` (24 casos; última ejecución, 24/24 aprobados y 5/5 crisis derivadas).
- Raspberry: `sh scripts/pi-deploy.sh` (datos de prueba) o `sh scripts/pi-deploy.sh real`.

## Clima espacial (DONKI, NASA)

- `server/donki.js` hace una sola consulta a `api.nasa.gov/DONKI/notifications` cada 3 h y la guarda en caché. Si se registra una clave gratuita en api.nasa.gov, se pone en `.env` como `NASA_API_KEY`; sin ella usa `DEMO_KEY`. Si DONKI falla, sirve la última copia buena.
- `src/app/space.js` contiene las reglas fijas por entorno (SEP, fulguraciones ≥ M5, tormentas Kp ≥ 7 y cinturón de radiación) y está cubierto por `tests/space.test.js`.
- En la app aparece en tres sitios: la tarjeta «Clima espacial», un bloque propio en la guía del chequeo (sin cambiar el color de salud) y el contexto de Paze y del explicador.
