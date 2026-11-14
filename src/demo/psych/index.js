// Mente — fase 2: conecta el motor puro (engine/) con la demo.
// Contrato que espera core/psych.js: mount(el, ctx), summary(id), contribute(id), onScenario(name, id).
// El registro de cada persona vive en store.state.psych[id]; si no existe, se crea con un
// historial simulado (los días anteriores al de misión) para que haya línea base desde el principio.

import * as P from './engine/index.js';
import strings from './strings.js';
import * as store from '../core/store.js';
import { register, t } from '../core/i18n.js';
import { h, card, viewHead, toast, fmt, responsive, lineChart, reducedMotion } from '../core/ui.js';
import { mountChat } from './chat.js';

register(strings);

/* ----------------------------------------------------------- registro -- */

export function ensure(id) {
  const st = store.getState();
  if (st.psych?.[id]) return st.psych[id];
  const idx = Math.max(0, store.crew().findIndex((c) => c.id === id));
  const rec = P.generateHistory(id, { seed: 11 + idx, days: Math.max(8, store.missionDay() - 1), profile: idx % 4 });
  store.update((s) => { s.psych ||= {}; s.psych[id] = rec; });
  return rec;
}

const opts = (id) => ({ day: store.missionDay(), physioHistory: store.physioHistory(id) });
const save = (id, rec) => store.update((s) => { s.psych ||= {}; s.psych[id] = rec; });

export function analyze(id) { ensure(id); return P.analyze(store.getState(), id, opts(id)); }
export function summary(id) { ensure(id); return P.summary(store.getState(), id, opts(id)); }
export function contribute(id) { ensure(id); return P.contribute(store.getState(), id, opts(id)); }

export function onScenario(name, id) {
  ensure(id);
  store.update((s) => {
    const next = P.onScenario({ psych: s.psych, missionDay: s.day }, name, id, { seed: (s.day * 31 + name.length) % 997 });
    s.psych = next.psych;
  });
}

/* ------------------------------------------------------------ vista -- */

const ORB = { ok: 'ok', watch: 'warn', alert: 'bad', nodata: 'none' };
const METRIC_LABEL = {
  valence: 'psych.mood.valence', energy: 'psych.mood.energy', tension: 'psych.mood.tension',
  sleepHours: 'psych.sleep.hours', sleepQuality: 'psych.sleep.quality', fatigue: 'psych.sleep.fatigue',
  workload: 'psych.workload.title', cohesion: 'psych.social.cohesion', isolation: 'psych.social.isolation',
  reaction: 'psych.pvt.mean', lapses: 'psych.pvt.lapses', falseStarts: 'psych.pvt.falseStarts',
};
const TABS = [
  ['overview', 'psych.overview.title'], ['daily', 'psych.daily.title'], ['pvt', 'psych.pvt.title'],
  ['breath', 'psych.breathing.title'], ['journal', 'psych.journal.title'], ['chat', 'psych.chat.title'],
  ['privacy', 'psych.privacy.title'],
];

export function mount(el, ctx) {
  const a = store.currentAstronaut();
  if (!a) { ctx.navigate('#/'); return () => {}; }
  ensure(a.id);
  let tab = 'overview';
  let cleanup = null;
  const panel = h('div', { class: 'psy-panel' });
  const tabs = h('div', { class: 'tabs psy-tabs', role: 'tablist', 'aria-label': t('psych.title') });

  function show(next) {
    tab = next;
    cleanup?.(); cleanup = null;
    [...tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const views = { overview, daily, pvt, breath, journal, chat, privacy };
    const r = views[tab](a, show);
    cleanup = r.cleanup || null;
    panel.replaceChildren(r.node || r);
  }
  for (const [id, key] of TABS) {
    tabs.append(h('button', { class: 'tab', type: 'button', role: 'tab', dataset: { tab: id }, onClick: () => show(id) }, t(key)));
  }

  el.replaceChildren(
    viewHead({ eyebrow: t('nav.mind'), title: t('psych.title'), lead: `${a.name} · ${t('psych.subtitle')}` }),
    h('div', { class: 'psy-tabbar' }, tabs),
    panel,
  );
  show(tab);
  return () => cleanup?.();
}

/* ---------------------------------------------------------- resumen -- */

function overview(a, go) {
  const r = analyze(a.id);
  const metricTabs = h('div', { class: 'tabs', role: 'group' });
  const chartBox = h('div', { class: 'chart-box' });
  let metric = r.factors[0]?.id && METRIC_LABEL[r.factors[0].id] ? r.factors[0].id : 'valence';

  const node = h('div', { class: 'stack' },
    card({ class: 'psy-status' },
      h('div', { class: 'psy-status__head' },
        h('span', { class: `orb orb--${ORB[r.status] || 'none'}`, 'aria-hidden': 'true' }),
        h('div', null, h('p', { class: 'label' }, t('psych.overview.title')), h('h2', { class: 'card-title' }, t(r.label)))),
      h('h3', { class: 'psy-h' }, t('psych.overview.factors')),
      r.factors.length
        ? h('ul', { class: 'psy-factors' }, r.factors.map((f) => h('li', null, t(f.key, fmtVars(f.vars)))))
        : h('p', { class: 'muted' }, t('psych.overview.noFactors')),
      h('p', { class: 'small muted psy-private' }, t('psych.overview.private'))),

    r.suggestions.length ? card(null,
      h('h2', { class: 'card-title' }, t('psych.countermeasures.title')),
      h('div', { class: 'psy-tips' }, r.suggestions.map((c) => h('div', { class: 'psy-tip' },
        h('b', null, t(c.titleKey)), h('p', null, t(c.key, c.vars)),
        c.id === 'breathe' ? h('button', { class: 'btn btn--glass glass btn--small', type: 'button', onClick: () => go('breath') }, t('psych.breathing.start')) : null)))) : null,

    card(null,
      h('h2', { class: 'card-title' }, t('psych.physiology.title')),
      r.physiology?.ready
        ? h('div', { class: 'psy-index' },
          h('div', { class: 'psy-index__bar' }, h('b', { style: { width: `${Math.round(r.physiology.value)}%` } })),
          h('p', null, h('b', null, `${Math.round(r.physiology.value)} / 100`), ' · ', t('psych.physiology.index')))
        : h('p', { class: 'muted' }, t('psych.physiology.missing')),
      h('p', { class: 'small muted' }, t('psych.physiology.method'))),

    card(null,
      h('h2', { class: 'card-title' }, t('psych.trends.title')),
      h('div', { class: 'row', style: { margin: '14px 0' } }, metricTabs),
      chartBox,
      h('p', { class: 'small muted' }, t('psych.trends.method'))),

    h('ul', { class: 'psy-notices' }, [...r.notices, 'psych.notice.sustained', 'psych.notice.missing'].map((k) => h('li', null, t(k)))),
  );

  let chart = null;
  const draw = () => {
    const m = r.metrics[metric];
    [...metricTabs.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === metric)));
    chart?.stop();
    const obs = (m?.observations || []).filter((o) => Number.isFinite(o.value));
    if (obs.length < 2) { chartBox.replaceChildren(h('p', { class: 'muted' }, t('psych.trends.empty'))); return; }
    chart = responsive(chartBox, (width) => {
      const svg = lineChart({
        width, height: width < 520 ? 220 : 280,
        xs: obs.map((o) => o.day),
        bands: [{
          lo: obs.map((o) => (o.baseline.ready ? o.baseline.median - 2 * o.baseline.scale : o.value)),
          hi: obs.map((o) => (o.baseline.ready ? o.baseline.median + 2 * o.baseline.scale : o.value)),
        }],
        series: [
          { values: obs.map((o) => o.value), cls: 'l-faint', dots: true, flags: obs.map((o) => (o.adverse ? 'warn' : '')) },
          { values: obs.map((o) => o.baseline.ewma ?? NaN), cls: 'l-ewma' },
        ],
        yFmt: (v) => fmt(v, metric === 'reaction' ? 0 : 1),
        xFmt: (d) => `D${d}`,
      });
      svg.setAttribute('aria-label', t('psych.trends.chart', { metric: t(METRIC_LABEL[metric]) }));
      return svg;
    });
  };
  for (const m of Object.keys(METRIC_LABEL)) {
    if (!r.metrics[m]) continue;
    metricTabs.append(h('button', { class: 'tab', type: 'button', dataset: { m }, onClick: () => { metric = m; draw(); } }, t(METRIC_LABEL[m])));
  }
  queueMicrotask(draw);
  return { node, cleanup: () => chart?.stop() };
}

function fmtVars(vars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 1) : v;
  return out;
}

/* ------------------------------------------------------ registro diario -- */

function slider(key, value, { min = 0, max = 10, step = 0.5, low, high }) {
  const out = h('b', null, fmt(value, step < 1 ? 1 : 0));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': t(key) });
  input.addEventListener('input', () => { out.textContent = fmt(+input.value, step < 1 ? 1 : 0); });
  return {
    node: h('label', { class: 'slider' },
      h('span', { class: 'psy-slider-head' }, h('span', null, t(key)), out),
      input,
      h('span', { class: 'slider-scale' }, h('span', null, low ? t(low) : min), h('span', null, high ? t(high) : max))),
    get: () => +input.value,
  };
}

function daily(a) {
  const day = store.missionDay();
  const rec = ensure(a.id);
  const today = rec.daily.find((d) => d.day === day) || {};
  const prev = rec.daily.filter((d) => d.day < day).at(-1) || {};
  const pick = (dom, k, def) => today[dom]?.[k] ?? prev[dom]?.[k] ?? def;

  const val = slider('psych.mood.valence', pick('mood', 'valence', 6), { low: 'psych.mood.valence.low', high: 'psych.mood.valence.high' });
  const ene = slider('psych.mood.energy', pick('mood', 'energy', 6), { low: 'psych.mood.energy.low', high: 'psych.mood.energy.high' });
  const ten = slider('psych.mood.tension', pick('mood', 'tension', 3), { low: 'psych.mood.tension.low', high: 'psych.mood.tension.high' });
  const hrs = slider('psych.sleep.hours', pick('sleep', 'hours', 7), { min: 0, max: 12, step: 0.25 });
  const qua = slider('psych.sleep.quality', pick('sleep', 'quality', 7), { low: 'psych.sleep.quality.low', high: 'psych.sleep.quality.high' });
  const fat = slider('psych.sleep.fatigue', pick('sleep', 'fatigue', 3), { low: 'psych.sleep.fatigue.low', high: 'psych.sleep.fatigue.high' });
  const wl = slider('psych.workload.question', today.workload ?? prev.workload ?? 5, { low: 'psych.workload.low', high: 'psych.workload.high' });

  const answers = { ...(today.social?.answers || {}) };
  const social = P.SOCIAL_ITEMS.map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    return h('fieldset', { class: 'psy-q' },
      h('legend', null, t(`psych.question.${id}`)),
      h('div', { class: 'tabs' }, [0, 1, 2, 3, 4].map((v) => {
        const b = h('button', { class: 'tab', type: 'button', 'aria-pressed': String(answers[id] === v), onClick: () => {
          answers[id] = v;
          [...b.parentNode.children].forEach((x, i) => x.setAttribute('aria-pressed', String(i === v)));
        } }, t(`psych.social.answer.${v}`));
        return b;
      })));
  });
  const msg = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' }, today.mood ? t('psych.daily.updated') : '');

  const node = h('div', { class: 'stack' },
    card(null, h('h2', { class: 'card-title' }, t('psych.daily.title')), h('p', { class: 'card-sub' }, t('psych.daily.subtitle')),
      h('div', { class: 'psy-sliders' }, val.node, ene.node, ten.node)),
    card(null, h('h2', { class: 'card-title' }, t('psych.sleep.title')), h('div', { class: 'psy-sliders' }, hrs.node, qua.node, fat.node),
      h('p', { class: 'small muted' }, t('psych.sleep.watch'))),
    card(null, h('h2', { class: 'card-title' }, t('psych.workload.title')), h('div', { class: 'psy-sliders' }, wl.node)),
    card(null, h('h2', { class: 'card-title' }, t('psych.social.title')), h('p', { class: 'card-sub' }, t('psych.social.subtitle')), h('div', { class: 'stack' }, social)),
    h('div', { class: 'row' }, h('button', { class: 'btn btn--light', type: 'button', onClick: () => {
      const entry = { day, mood: { valence: val.get(), energy: ene.get(), tension: ten.get() },
        sleep: { hours: hrs.get(), quality: qua.get(), fatigue: fat.get() }, workload: wl.get() };
      const complete = P.SOCIAL_ITEMS.every((item) => Number.isInteger(answers[typeof item === 'string' ? item : item.id]));
      if (Object.keys(answers).length && !complete) { msg.textContent = t('psych.error.social'); return; }
      if (complete) entry.social = { answers: { ...answers } };
      try {
        save(a.id, P.recordDaily(ensure(a.id), entry));
        msg.textContent = t('psych.daily.saved', { day });
        toast(t('psych.daily.saved', { day }));
      } catch { msg.textContent = t('psych.error.generic'); }
    } }, t('psych.common.save')), msg),
  );
  return node;
}

/* ----------------------------------------------------- prueba de vigilancia -- */

function pvt(a) {
  const TOTAL = 10;
  const TIMEOUT = 3000;
  let trials = [], plan = [], i = 0, timer = 0, shownAt = 0, state = 'idle';
  const pad = h('button', { class: 'psy-pvt', type: 'button', 'aria-live': 'polite' }, t('psych.pvt.start'));
  const progress = h('p', { class: 'small muted' }, t('psych.pvt.controls'));
  const result = h('div');

  function stop(reason) {
    clearTimeout(timer);
    if (state !== 'idle' && state !== 'done' && reason) { toast(t(reason)); }
    state = 'idle';
    pad.className = 'psy-pvt';
    pad.textContent = t('psych.pvt.start');
  }
  function next() {
    if (i >= TOTAL) return finish();
    state = 'wait';
    pad.className = 'psy-pvt is-wait';
    pad.textContent = t('psych.pvt.wait');
    progress.textContent = t('psych.pvt.progress', { current: i + 1, total: TOTAL });
    timer = setTimeout(() => {
      state = 'go'; shownAt = performance.now();
      pad.className = 'psy-pvt is-go';
      pad.textContent = t('psych.pvt.respond');
      timer = setTimeout(() => { trials.push({ timeout: true }); i++; flash('psych.pvt.timeout'); }, TIMEOUT);
    }, plan[i].delayMs);
  }
  function flash(key, vars) {
    state = 'between';
    pad.className = 'psy-pvt';
    pad.textContent = t(key, vars);
    timer = setTimeout(next, 900);
  }
  function press() {
    if (state === 'idle' || state === 'done') {
      trials = []; i = 0; result.replaceChildren();
      plan = P.planStimuli({ seed: (store.missionDay() * 7 + Date.now()) % 100000, count: TOTAL });
      next();
    } else if (state === 'wait') {
      clearTimeout(timer); trials.push({ falseStart: true }); i++; flash('psych.pvt.falseStart');
    } else if (state === 'go') {
      clearTimeout(timer);
      const ms = Math.round(performance.now() - shownAt);
      trials.push(ms); i++; flash('psych.pvt.result', { ms });
    }
  }
  function finish() {
    state = 'done';
    const day = store.missionDay();
    const score = P.scoreVigilance(trials);
    try { save(a.id, P.recordVigilance(ensure(a.id), { day, trials })); } catch { toast(t('psych.error.storage')); }
    pad.className = 'psy-pvt';
    pad.textContent = t('psych.pvt.repeat');
    progress.textContent = t('psych.pvt.finished');
    const stat = (k, v) => h('div', { class: 'tile glass' }, h('span', { class: 'tile-label' }, t(k)), h('b', { class: 'tile-value' }, v));
    result.replaceChildren(h('div', { class: 'tiles psy-pvt-tiles' },
      stat('psych.pvt.mean', score.meanMs != null ? `${Math.round(score.meanMs)} ms` : '—'),
      stat('psych.pvt.median', score.medianMs != null ? `${Math.round(score.medianMs)} ms` : '—'),
      stat('psych.pvt.slowest10', score.slowest10Ms != null ? `${Math.round(score.slowest10Ms)} ms` : '—'),
      stat('psych.pvt.lapses', String(score.lapses)),
      stat('psych.pvt.falseStarts', String(score.falseStarts)),
      stat('psych.pvt.valid', String(score.validResponses))),
      h('p', { class: 'small muted' }, t('psych.pvt.scoring')));
  }
  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  const onKey = (e) => { if ((e.key === ' ' || e.key === 'Enter') && document.activeElement === pad) { e.preventDefault(); press(); } };
  pad.addEventListener('keydown', onKey);
  const onHide = () => { if (document.hidden && state !== 'idle' && state !== 'done') stop('psych.pvt.background'); };
  document.addEventListener('visibilitychange', onHide);

  const node = h('div', { class: 'stack' }, card(null,
    h('h2', { class: 'card-title' }, t('psych.pvt.title')), h('p', { class: 'card-sub' }, t('psych.pvt.subtitle')),
    pad, progress, result, h('p', { class: 'small muted' }, t('psych.pvt.notice'))));
  return { node, cleanup: () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onHide); } };
}

/* -------------------------------------------------------- respiración -- */

function breath(a) {
  const IN = 4, OUT = 6, DURATION = 60;
  const ring = h('div', { class: 'psy-breath__ring' });
  const label = h('p', { class: 'psy-breath__label', 'aria-live': 'polite' }, '');
  const left = h('p', { class: 'small muted' }, t('psych.breathing.rhythm', { inhale: IN, exhale: OUT }));
  const count = () => ensure(a.id).breathing.filter((b) => b.completed).length;
  const hist = h('p', { class: 'small muted' }, t('psych.breathing.history', { count: count() }));
  let raf = 0, start = 0, running = false;
  const btn = h('button', { class: 'btn btn--light', type: 'button', onClick: () => (running ? end(false) : begin()) }, t('psych.breathing.start'));

  function frame(now) {
    const el = (now - start) / 1000;
    if (el >= DURATION) { end(true); return; }
    const c = el % (IN + OUT);
    const inhale = c < IN;
    const p = inhale ? c / IN : 1 - (c - IN) / OUT;
    const ease = 0.5 - Math.cos(Math.PI * p) / 2;
    ring.style.transform = `scale(${0.6 + ease * 0.55})`;
    const txt = t(inhale ? 'psych.breathing.inhale' : 'psych.breathing.exhale');
    if (label.textContent !== txt) label.textContent = txt;
    left.textContent = t('psych.breathing.remaining', { seconds: Math.ceil(DURATION - el) });
    raf = requestAnimationFrame(frame);
  }
  function begin() {
    running = true; start = performance.now(); btn.textContent = t('psych.breathing.stop');
    if (reducedMotion()) ring.style.transition = 'none';
    raf = requestAnimationFrame(frame);
  }
  function end(completed) {
    cancelAnimationFrame(raf);
    const secs = Math.round((performance.now() - start) / 1000);
    running = false; btn.textContent = t('psych.breathing.start');
    ring.style.transform = 'scale(0.6)'; label.textContent = '';
    left.textContent = t(completed ? 'psych.breathing.complete' : 'psych.breathing.stopped');
    if (secs >= 5) {
      try { save(a.id, P.recordBreathing(ensure(a.id), { id: `b-${Date.now()}`, day: store.missionDay(), durationSec: Math.min(secs, DURATION), completed, inhaleSec: IN, exhaleSec: OUT })); } catch { /* sin almacenamiento */ }
      hist.textContent = t('psych.breathing.history', { count: count() });
    }
  }
  const node = card({ class: 'psy-breath' },
    h('h2', { class: 'card-title' }, t('psych.breathing.title')), h('p', { class: 'card-sub' }, t('psych.breathing.intro')),
    h('div', { class: 'psy-breath__stage' }, ring, label), left, btn,
    h('p', { class: 'small muted' }, t('psych.breathing.comfort')), hist);
  return { node, cleanup: () => cancelAnimationFrame(raf) };
}

/* ------------------------------------------------------------- diario -- */

function journal(a) {
  const area = h('textarea', { class: 'psy-text', rows: 5, placeholder: t('psych.journal.placeholder'), 'aria-label': t('psych.journal.prompt'), maxlength: 4000 });
  const list = h('ul', { class: 'psy-journal' });
  function draw() {
    const items = [...ensure(a.id).journal].reverse();
    list.replaceChildren(...(items.length ? items.map((j) => h('li', null,
      h('div', { class: 'row' }, h('span', { class: 'label' }, t('psych.common.day', { day: j.day })), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn--glass glass btn--small', type: 'button', onClick: () => {
          if (!confirm(t('psych.journal.confirmDelete'))) return;
          save(a.id, P.removeJournal(ensure(a.id), j.id)); toast(t('psych.journal.deleted')); draw();
        } }, t('psych.journal.delete'))),
      h('p', null, j.text))) : [h('li', { class: 'muted' }, t('psych.journal.empty'))]));
  }
  draw();
  return card(null,
    h('h2', { class: 'card-title' }, t('psych.journal.title')), h('p', { class: 'card-sub' }, t('psych.journal.prompt')),
    area,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn btn--light', type: 'button', onClick: () => {
      const text = area.value.trim();
      if (!text) return;
      save(a.id, P.writeJournal(ensure(a.id), { id: `j-${Date.now()}`, day: store.missionDay(), text }));
      area.value = ''; toast(t('psych.journal.saved')); draw();
    } }, t('psych.common.save'))),
    h('p', { class: 'small muted' }, t('psych.journal.privacy')),
    list);
}

/* ---------------------------------------------------------- privacidad -- */

function privacy(a) {
  const keys = Object.keys(P.DEFAULT_SHARING);
  const rows = h('div', { class: 'psy-switches' });
  function draw() {
    const sh = ensure(a.id).sharing;
    rows.replaceChildren(...keys.map((k) => h('label', { class: `psy-switch ${k !== 'aggregate' && !sh.aggregate ? 'is-off' : ''}` },
      h('input', { type: 'checkbox', checked: !!sh[k], disabled: k !== 'aggregate' && !sh.aggregate, onChange: (e) => {
        save(a.id, P.setSharing(ensure(a.id), { [k]: e.target.checked }));
        toast(t('psych.privacy.saved')); draw();
      } }),
      h('span', null, t(`psych.privacy.${k}`), k === 'factors' ? h('small', null, t('psych.privacy.factorsHint')) : null))));
  }
  draw();
  return card(null,
    h('h2', { class: 'card-title' }, t('psych.privacy.title')), h('p', { class: 'card-sub' }, t('psych.privacy.default')),
    rows,
    h('ul', { class: 'psy-notices' }, ['psych.privacy.off', 'psych.privacy.journal', 'psych.privacy.chat', 'psych.privacy.local', 'psych.privacy.earth'].map((k) => h('li', null, t(k)))));
}

/* ------------------------------------------------- psicóloga (IA) -- */

function chat(a) {
  return mountChat({
    astronaut: a,
    // Contexto que recibe la IA: solo lo que la propia persona ve en Resumen. Nunca el diario.
    context: () => {
      const r = analyze(a.id);
      const last = (m) => r.metrics[m]?.latest;
      return {
        name: a.name.split(' ')[0], role: a.role, day: store.missionDay(),
        status: t(r.label),
        factors: r.factors.map((f) => t(f.key, fmtVars(f.vars))),
        today: Object.fromEntries(Object.keys(METRIC_LABEL)
          .filter((m) => last(m)?.day === store.missionDay())
          .map((m) => [t(METRIC_LABEL[m]), Math.round(last(m).value * 10) / 10])),
        physiologyIndex: r.physiology?.ready ? Math.round(r.physiology.value) : null,
      };
    },
  });
}
