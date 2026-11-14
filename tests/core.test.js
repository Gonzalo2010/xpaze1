// Contrato del núcleo (store e i18n) y cobertura de textos en los dos idiomas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import * as store from '../src/demo/core/store.js';
import * as i18n from '../src/demo/core/i18n.js';
import strings from '../src/demo/core/strings.js';
import { SCENARIO_NAMES, instantCheck, injectScenario } from '../src/demo/core/engine/mission.js';
import { CREW, FEATURES } from '../src/demo/core/engine/crew.js';

i18n.register(strings);

test('i18n: contrato', () => {
  i18n.setLang('es');
  const seen = [];
  const off = i18n.onLangChange((l) => seen.push(l));
  i18n.setLang('en');
  assert.equal(i18n.lang(), 'en');
  assert.equal(i18n.t('status.watch'), 'Watch');
  i18n.setLang('es');
  assert.equal(i18n.t('status.watch'), 'A vigilar');
  assert.equal(i18n.t('shell.day', { day: 42 }), 'Día 42');
  assert.equal(i18n.t('no.existe'), 'no.existe');
  i18n.register({ es: { 'psych.x': 'hola {n}' }, en: { 'psych.x': 'hi {n}' } });
  assert.equal(i18n.t('psych.x', { n: 3 }), 'hola 3');
  off();
  i18n.setLang('en'); i18n.setLang('es');
  assert.deepEqual(seen, ['en', 'es']);
});

test('store: contrato', () => {
  store.reset();
  const s = store.getState();
  assert.equal(JSON.stringify(s), JSON.stringify(JSON.parse(JSON.stringify(s))), 'serializable');
  assert.equal(store.missionDay(), 42);
  assert.equal(store.currentAstronaut(), null);
  assert.deepEqual(s.psych, {});
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.update((d) => { d.astronautId = 'noa'; d.psych.noa = { hello: 1 }; });
  assert.equal(calls, 1);
  const a = store.currentAstronaut();
  assert.equal(a.id, 'noa');
  assert.equal(a.name, 'Noa Lindqvist');
  assert.equal(a.role, 'Oficial médico');
  for (const k of ['hr', 'hrv', 'temp', 'spo2', 'sleepH']) assert.ok(Number.isFinite(a.baseline[k]));
  const h = store.physioHistory('noa');
  assert.equal(h.length, 42);
  assert.deepEqual(Object.keys(h[41]), ['day', 'hr', 'hrv', 'temp', 'spo2', 'sleepH', 'sleepQuality', 'activityMin', 'context']);
  h[0].hr = -1;
  assert.notEqual(store.physioHistory('noa')[0].hr, -1, 'devuelve copias');
  assert.equal(store.latestCheck('noa'), null);
  store.update((d) => { instantCheck(d, 'noa', 123); });
  assert.equal(store.latestCheck('noa').day, 42);
  assert.equal(store.todayCheck('noa').astronautId, 'noa');
  assert.deepEqual(store.physioHistory('nadie'), []);
  off();
  store.update(() => {});
  assert.equal(calls, 2);
  store.reset();
  assert.equal(store.latestCheck('noa'), null);
  assert.deepEqual(store.getState().psych, {});
});

test('textos: mismas claves en español e inglés, sin vacíos', () => {
  const es = Object.keys(strings.es).sort(), en = Object.keys(strings.en).sort();
  assert.deepEqual(es.filter((k) => !(k in strings.en)), [], 'faltan en inglés');
  assert.deepEqual(en.filter((k) => !(k in strings.es)), [], 'faltan en español');
  for (const k of es) {
    assert.ok(strings.es[k].trim() && strings.en[k].trim(), k);
    const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(strings.es[k]), vars(strings.en[k]), `variables distintas en ${k}`);
  }
});

test('textos: todas las claves que usa el código existen', () => {
  const root = new URL('../src/demo/', import.meta.url).pathname;
  const files = ['main.js', ...readdirSync(join(root, 'views')).map((f) => `views/${f}`), ...readdirSync(join(root, 'core')).filter((f) => f.endsWith('.js') && f !== 'strings.js').map((f) => `core/${f}`)];
  const missing = new Set();
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)) if (!(m[1] in strings.es)) missing.add(`${f}: ${m[1]}`);
  }
  assert.deepEqual([...missing], []);
  // claves compuestas en tiempo de ejecución
  const dyn = [
    ...SCENARIO_NAMES.flatMap((n) => [`scn.${n}`, `scn.${n}.d`]),
    ...FEATURES.flatMap((m) => [`m.${m}`, `m.${m}.in`]),
    ...CREW.map((a) => a.roleKey),
    ...['normal', 'watch', 'anomaly', 'unreliable'].flatMap((s) => [`status.${s}`, `auto.${s}`, `earth.reply.${s}`]),
    ...['thermal', 'oxygen', 'sleep', 'cardio', 'strain', 'cabin', 'unusual', 'generic'].flatMap((p) => [`pattern.${p}`, `head.watch.${p}`, `head.anomaly.${p}`]),
    ...['rest', 'exercise', 'sleep'].map((c) => `ctx.${c}`),
    ...['ok', 'watch', 'alert', 'nodata'].map((s) => `mind.status.${s}`),
    ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].map((r) => `lab.fu.${r}`),
    ...['ecg', 'ppg', 'temp', 'cabin', 'analysis'].map((p) => `check.phase.${p}`),
    ...['outbound', 'review', 'inbound', 'answered'].map((p) => `earth.phase.${p}`),
  ];
  assert.deepEqual(dyn.filter((k) => !(k in strings.es)), []);
});

test('explicaciones: cada línea que genera el motor tiene texto en los dos idiomas', () => {
  const keys = new Set();
  for (const name of [null, ...SCENARIO_NAMES]) {
    for (const p of CREW) {
      store.reset();
      store.update((d) => {
        if (name) injectScenario(d, name, p.id);
        const { check } = instantCheck(d, p.id, 0);
        const r = check.analysis;
        for (const x of [r.headline, r.auto, ...r.lines, ...r.actions, ...check.context.evidence]) keys.add(x.key);
      });
    }
  }
  store.reset();
  assert.ok(keys.size > 15);
  assert.deepEqual([...keys].filter((k) => !(k in strings.es) || !(k in strings.en)), []);
});
