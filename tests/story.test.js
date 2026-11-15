// Historias simuladas de 30 días, tendencias frente a «tu normal» e informe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedStory, trendInsights, resultsFromEntry, reportText } from '../src/app/story.js';
import { setLang } from '../src/app/i18n.js';

setLang('es');
const NOW = Date.UTC(2026, 10, 15, 12);

test('cada persona tiene 30 días de chequeos completos', () => {
  for (const k of ['vega', 'iker', 'noa', 'amara', 'default']) {
    const h = seedStory(`UID${k}`, k, NOW);
    assert.equal(h.length, 30, k);
    for (const e of h) {
      assert.ok(e.bpm && e.bp && e.glucose && e.mind && e.temp && e.rmssd && e.grip, k);
      assert.ok(e.at < NOW, k);
      assert.ok([0, 1, 2].includes(e.overall), k);
    }
  }
});

test('Vega: las últimas noches con poco sueño se detectan frente a su normal', () => {
  const t = trendInsights(seedStory('04A37F1C', 'vega', NOW)).map((x) => x.text).join(' ');
  assert.match(t, /sueño|pulso|HRV/);
});

test('Amara: pierde fuerza de agarre y su pulso bajo es su normal', () => {
  const t = trendInsights(seedStory('04E1663A', 'amara', NOW)).map((x) => x.text).join(' ');
  assert.match(t, /agarre/);
  assert.match(t, /es tu normal/);
});

test('Noa: patrón repetido de noches cortas', () => {
  const t = trendInsights(seedStory('04C819D4', 'noa', NOW)).map((x) => x.text).join(' ');
  assert.match(t, /menos de 6 h/);
});

test('sin historial suficiente no se inventan tendencias', () => {
  assert.deepEqual(trendInsights([]), []);
});

test('el informe incluye el color global, las medidas y que son datos simulados', () => {
  const e = seedStory('X', 'default', NOW).at(-1);
  const txt = reportText({ person: { name: 'Vega Mar' }, entry: e, results: resultsFromEntry(e), plan: { now: [] } });
  assert.match(txt, /INFORME XPAZE/);
  assert.match(txt, /Resultado global: (VERDE|AMARILLO|ROJO)/);
  assert.match(txt, /Pulso en reposo/);
  assert.match(txt, /simulados/);
});

test('Íker: picos de estrés que se repiten', () => {
  const t = trendInsights(seedStory('045BE290', 'iker', NOW)).map((x) => x.text).join(' ');
  assert.match(t, /7 o más/);
});
