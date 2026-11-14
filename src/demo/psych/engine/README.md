# Mente: motor puro, fase 1

Entrada pública: `src/demo/psych/engine/index.js`. ES modules, sin dependencias,
DOM, temporizadores, persistencia, red ni imports del núcleo. Los valores devueltos
son serializables salvo el generador `createRng`, que es una función con estado local.
Las operaciones sobre registros y estado devuelven objetos nuevos; no mutan la entrada.
Las ramas sin cambios pueden conservar referencias: consumirlas como inmutables.

## Estado

```js
state.psych[astronautId] = {
  version: 1,
  daily: [{
    day: 1,
    mood: { valence: 7, energy: 6, tension: 2 }, // 0–10
    sleep: { hours: 7.5, quality: 8, fatigue: 2 }, // hours 0–24; resto 0–10
    workload: 4, // 0–10
    social: { answers: {
      teamSupport: 3, teamVoice: 3, distance: 1, connection: 1 // enteros 0–4
    } }
  }],
  vigilance: [{ day: 1, trials: [250, { reactionMs: 510 }, { falseStart: true }, { timeout: true }] }],
  journal: [{ id: 'entry-1', day: 1, text: 'Texto privado' }],
  breathing: [{ id: 'session-1', day: 1, durationSec: 60, completed: true, inhaleSec: 4, exhaleSec: 6 }],
  physioHistory: [], // caché opcional / historial simulado; mismo formato de SPEC.md
  sharing: {
    aggregate: true, factors: false, mood: false, vigilance: false,
    sleep: false, workload: false, social: false, physiology: false, breathing: false
  }
}
```

`daily` admite dominios omitidos. El cuestionario completo requiere sus cuatro
respuestas. `scoreSocial` también permite analizar una dimensión completa cuando
falta la otra, devolviendo `null` para la incompleta. Las escrituras validan escalas;
no convertir valores ausentes en cero. Un nuevo registro del mismo día sustituye
ese dominio, conservando los demás. Una nueva prueba del mismo día sustituye la
anterior: repetir intentos no puede fabricar una señal de varios días. IDs y días
los proporciona el llamador; los tiempos de reacción son diferencias en ms medidas
por la vista. El motor no interpreta HTML ni analiza texto del diario.

## API exportada

| Firma | Resultado |
| --- | --- |
| `createPsychRecord()` | Registro vacío con privacidad por defecto |
| `recordDaily(record, {day, mood?, sleep?, workload?, social?})` | Registro actualizado |
| `recordVigilance(record, {day, trials})` | Registro actualizado |
| `scoreSocial(answers)` | `{cohesion, isolation}`, medias 0–4 o `null` |
| `writeJournal(record, {id, day, text})` | Registro con entrada creada o sustituida |
| `removeJournal(record, id)` | Registro sin esa entrada |
| `recordBreathing(record, {id, day, durationSec, completed, inhaleSec=4, exhaleSec=6})` | Registro con sesión |
| `setSharing(record, changes)` | Registro con opciones booleanas permitidas |
| `median(values)` / `mad(values, center?)` | Número o `null` |
| `ewma(values, alpha=0.2)` | Media ponderada o `null` |
| `baseline(values, {minSamples=7, scaleFloor=1, alpha=0.2}?)` | `{ready, count, median, mad, scale, ewma}` |
| `robustZ(value, baseline)` | `(value-median)/scale` o `null` |
| `analyzeMetric(points, options?)` | Línea base, observaciones causales, último valor, días, porcentaje y cambio sostenido |
| `createRng(seed=1)` | Función determinista que devuelve valores en `[0,1)` |
| `planStimuli({seed=1, count=10, minIntervalMs=2000, maxIntervalMs=5000}?)` | `[{index, delayMs}]`; cada espera empieza al terminar el intento anterior |
| `scoreVigilance(trials=[])` | `{meanMs, medianMs, slowest10Ms, lapses, falseStarts, omissions, validResponses, invalid, trials}` |
| `physiologicalStress(history=[], {day}?)` | `{value, ready, hr, hrv, days, sustained, explanation}` |
| `analyze(state, astronautId, {physioHistory, day}?)` | Análisis **privado** completo, factores y contramedidas |
| `suggestCountermeasures(factors=[])` | Descriptores i18n de acciones sugeridas |
| `summary(state, astronautId, {physioHistory, day}?)` | `{status, label, factors, shared, metrics?}`, filtrado por privacidad |
| `contribute(state, astronautId, options?)` | Factores compartibles; `[]` por defecto |
| `generateHistory(astronautId, {seed=1, days=28, profile, scenario, scenarioDays=5}?)` | Registro simulado reproducible |
| `applyScenario(record, name, {startDay, duration=5, seed}?)` | Registro con escenario; añade días por defecto |
| `onScenario(state, name, astronautId, options?)` | Estado nuevo; por defecto aplica el escenario a los últimos días hasta el día actual |

Constantes: `DEFAULT_SHARING`, `SOCIAL_ITEMS`, `METRICS`, `PROFILES`, `SCENARIOS`.
`profile` acepta índice 0–3 o ID: `steady`, `reflective`, `active`, `methodical`.
Para garantizar cuatro perfiles distintos en la tripulación, asignar los índices
0–3 explícitamente. Sin perfil se obtiene una elección estable basada en el ID,
que puede coincidir para dos astronautas.

Escenarios: `poor-sleep`, `sustained-stress`, `isolation`, `crew-conflict`,
`workload`, `recovery`. `generateHistory` aplica el escenario al final del historial.
`applyScenario` permite reemplazar días existentes mediante `startDay`; conserva
el diario, las sesiones de respiración y las opciones de privacidad. `recovery`
se aproxima gradualmente a los valores del perfil y termina con días normales.
La inyección nunca avanza por sí sola el día de misión del núcleo.

## Cálculo e interpretación

- `analyzeMetric` recibe `[{day, value}]`. Opciones: `direction` (1 o −1),
  `scaleFloor`, `minSamples`, `sustainedDays` (3), `threshold` (2), `alpha`, `asOf`.
- Siete días distintos inicializan cada referencia. La octava observación ya puede
  compararse; no hay comparación retrospectiva durante la inicialización.
- Escala robusta: `max(scaleFloor, 1.4826 × MAD)`. El suelo evita divisiones por
  cero y sensibilidad desproporcionada en series constantes. `METRICS` define
  suelos y dirección adversa por métrica. HR usa 3 lpm; HRV usa 5 ms.
- Mediana/MAD: últimos 28 valores aceptados. EWMA: actualización causal con alfa
  0,2 de los valores aceptados. Una desviación absoluta ≥2 no actualiza ninguna
  referencia. Esto evita absorber la mala racha; también exige revisar la referencia
  si una nueva rutina estable cambia permanentemente el patrón personal.
- Tres días consecutivos con desviación adversa ≥2 generan un factor. Un día ausente,
  normal o posterior al último dato rompe la continuidad. Duplicados cuentan una
  sola vez. `latest.baseline` es la referencia anterior a esa observación;
  `baseline` es la referencia después de procesar el historial.
- `watch`: al menos un factor sostenido. `alert`: dos dominios distintos y un factor
  de al menos cuatro días, o un factor de cinco días con desviación actual ≥3.
  Varias métricas del mismo dominio no se cuentan como dominios independientes.
  `nodata`: no hay ninguna métrica comparable del día actual. `ok`: existe alguna
  métrica comparable, sin factores sostenidos; no implica cobertura de todas ellas.
- El día efectivo viene de `options.day`, luego `state.missionDay` si es entero,
  o del último día observado. La fase 2 debe pasar `store.missionDay()` explícitamente
  para no presentar un registro antiguo como actual.
- Índice fisiológico: media de desviaciones adversas de pulso y HRV, escalada a
  0–100: `min(100, (max(0,zHR)+max(0,-zHRV))/12*100)`. No es una probabilidad.
  El factor exige cambios sostenidos **en ambas** métricas. Requiere ambas mediciones
  positivas en el mismo registro y contexto explícito `rest`, `resting` o `reposo`
  (cadena, `context.type` o `context.activity`). Otros contextos no se infieren.
- Sueño del reloj: se usa `sleepH` como respaldo. El autorregistro del mismo día
  tiene prioridad. No se infiere la escala de `sleepQuality` del núcleo; solo se
  analiza la calidad 0–10 declarada en Mente. HRV se espera en ms y pulso en lpm.
- PVT: tiempos <100 ms o `falseStart:true` son anticipaciones; ≥500 ms son lapsos.
  `timeout:true` cuenta como lapso sin inventar un tiempo de reacción. Las medias
  excluyen anticipaciones, omisiones y valores inválidos. El 10 % más lento usa
  `ceil(n*0.1)` respuestas válidas. Pruebas sin ninguna observación usable no se
  interpretan como cero lapsos. La vista debe guardar solo pruebas terminadas y
  comparar sesiones de la misma longitud; cancelar al perder visibilidad/foco.
- Son reglas explícitas para una demo, sin validación clínica. No hay etiquetas
  diagnósticas. La inicialización presupone días representativos: no puede detectar
  un cambio que ya estaba presente durante toda la referencia inicial.

## Integración pendiente de fase 2

```js
import * as psych from './engine/index.js';
import strings from './strings.js';

// Dentro del futuro adaptador, con store e i18n inyectados:
const options = {
  day: store.missionDay(),
  physioHistory: store.physioHistory(astronautId),
};
const privateView = psych.analyze(store.getState(), astronautId, options);
const shared = psych.summary(store.getState(), astronautId, options);
const label = i18n.t(shared.label);
const explanations = shared.factors.map(f => i18n.t(f.key, f.vars));
// Registrar strings mediante i18n.register(strings).
```

`label` es una **clave i18n**, no una cadena localizada. Factores:
`{id, domain, key, vars, days, strength}`. Contramedidas:
`{id, titleKey, key, vars}`. Registrar los diccionarios una vez en fase 2.

El historial inyectado tiene prioridad sobre `record.physioHistory`. Los escenarios
modifican la copia local de simulación; el adaptador debe decidir cómo coordinarla
con las lecturas del núcleo. Para revisar solo los escenarios de Mente puede usar
esa copia local; para combinar con el reloj real del núcleo, inyectar su historial.

El oficial médico y los informes para Tierra deben usar **solo** `summary` y
`contribute`, nunca `analyze` ni el registro completo. Compartir factores es un
consentimiento independiente que puede revelar valores de varios dominios; el
texto de privacidad lo explica. Desactivar `aggregate` bloquea todos los detalles.
El diario nunca se exporta; el motor tampoco accede a red ni almacenamiento. La
persistencia local y el escape de texto al renderizar pertenecen a fase 2. No
prometer cifrado, retirada de informes enviados ni aislamiento entre usuarios del
mismo navegador.

Verificación: `node --test tests/psych/*.test.js`. No requiere compilación de Vite.
