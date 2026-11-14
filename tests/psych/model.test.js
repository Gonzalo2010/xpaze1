import test from 'node:test';
import assert from 'node:assert/strict';
import { createPsychRecord, recordDaily, recordVigilance, writeJournal, removeJournal, recordBreathing, setSharing, scoreSocial } from '../../src/demo/psych/engine/index.js';

test('daily updates preserve other domains, replace the day, and validate scales', () => {
  const empty = createPsychRecord();
  const first = recordDaily(empty, { day: 1, mood: { valence: 7, energy: 6, tension: 2 } });
  const next = recordDaily(first, { day: 1, workload: 8 });
  assert.equal(next.daily.length, 1);
  assert.equal(next.daily[0].mood.valence, 7);
  assert.equal(first.daily[0].workload, undefined);
  assert.deepEqual(empty.daily, []);
  assert.throws(() => recordDaily(empty, { day: 0 }), RangeError);
  assert.throws(() => recordDaily(empty, { day: 1, workload: 11 }), RangeError);
  assert.throws(() => recordDaily(empty, { day: 1, mood: { valence: NaN } }), RangeError);
});

test('own social items score dimensions independently without treating missing answers as zero', () => {
  assert.deepEqual(scoreSocial({ teamSupport: 4, teamVoice: 2, distance: 1, connection: 3 }), { cohesion: 3, isolation: 2 });
  assert.deepEqual(scoreSocial({ teamSupport: 4 }), { cohesion: null, isolation: null });
  assert.throws(() => recordDaily(createPsychRecord(), { day: 1, social: { answers: {} } }), RangeError);
});

test('journal and breathing use caller IDs and mission days without clocks', () => {
  const initial = createPsychRecord();
  const entry = { id: 'j1', day: 1, text: '<script>private</script>' };
  const withJournal = writeJournal(initial, entry);
  const updated = writeJournal(withJournal, { ...entry, text: 'personal' });
  assert.equal(updated.journal.length, 1);
  assert.equal(withJournal.journal[0].text, entry.text);
  assert.deepEqual(removeJournal(updated, 'j1').journal, []);
  const breathing = recordBreathing(updated, { id: 'b1', day: 2, durationSec: 60, completed: true });
  assert.equal(breathing.breathing[0].inhaleSec, 4);
  assert.equal(breathing.breathing[0].exhaleSec, 6);
  assert.equal(updated.breathing.length, 0);
  assert.throws(() => recordBreathing(initial, { id: 'b', day: 1, durationSec: -1, completed: true }), RangeError);
});

test('vigilance stores independent trial data and same-day retests replace earlier tests', () => {
  const trials = [200, { timeout: true }];
  const record = recordVigilance(createPsychRecord(), { day: 3, trials });
  trials[1].timeout = false;
  assert.equal(record.vigilance[0].trials[1].timeout, true);
  assert.equal(recordVigilance(record, { day: 3, trials: [250] }).vigilance.length, 1);
});

test('sharing accepts only boolean allowlisted choices and cannot enable journal sharing', () => {
  const initial = createPsychRecord();
  const next = setSharing(initial, { journal: true, factors: true, mood: 'yes' });
  assert.equal(next.sharing.journal, undefined);
  assert.equal(next.sharing.factors, true);
  assert.equal(next.sharing.mood, false);
  assert.equal(initial.sharing.factors, false);
});
