import test from 'node:test';
import assert from 'node:assert/strict';
import strings from '../../src/demo/psych/strings.js';
import { analyze, generateHistory, METRICS, SOCIAL_ITEMS, SCENARIOS, PROFILES } from '../../src/demo/psych/engine/index.js';
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('all ES/EN strings use psych prefix and preserve interpolation variables', () => {
  assert.deepEqual(Object.keys(strings.es).sort(), Object.keys(strings.en).sort());
  for (const key of Object.keys(strings.es)) {
    assert.ok(key.startsWith('psych.'));
    assert.ok(strings.es[key].length > 0 && strings.en[key].length > 0);
    assert.deepEqual(placeholders(strings.es[key]), placeholders(strings.en[key]), key);
  }
});

test('every emitted explanation and suggested action resolves in both languages', () => {
  const keys = [...Object.keys(METRICS).map(id => `psych.factor.${id}`), ...SOCIAL_ITEMS.map(item => item.key),
    ...PROFILES.map(profile => `psych.profile.${profile.id}`), ...SCENARIOS.map(id => `psych.scenario.${id}`)];
  for (const scenario of SCENARIOS) {
    const result = analyze({ psych: { eva: generateHistory('eva', { scenario }) } }, 'eva');
    keys.push(result.label, ...result.notices, result.physiology.explanation.key);
    for (const item of [...result.factors, ...result.suggestions]) {
      keys.push(item.key);
      if (item.titleKey) keys.push(item.titleKey);
      for (const variable of placeholders(strings.es[item.key])) assert.notEqual(item.vars[variable], undefined, `${item.key}: ${variable}`);
    }
  }
  for (const key of keys) for (const lang of ['es', 'en']) assert.equal(typeof strings[lang][key], 'string', `${lang}: ${key}`);
});
