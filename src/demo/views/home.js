// #/ — Tripulación: se entra acercando la tarjeta RFID de un astronauta al lector.

import { h, s, fmt, viewHead, statusPill, reducedMotion } from '../core/ui.js';
import { isLocalBridgeLocation, getSensorSnapshot, requestWatchSpo2 } from '../core/sensors.js';

const TRANSIT_DAYS = 210; // viaje de ida simulado

function rfidIcon(size = 44) {
  return s('svg', { viewBox: '0 0 48 48', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'aria-hidden': 'true' },
    s('path', { d: 'M14 17a10 10 0 0 1 0 14' }), s('path', { d: 'M21 12a17 17 0 0 1 0 24' }), s('path', { d: 'M28 7a24 24 0 0 1 0 34' }));
}

export function mount(el, ctx) {
  const { store, navigate, i18n: { t } } = ctx;
  const state = store.getState();
  const day = store.missionDay();
  let timer = 0;

  const status = h('p', { class: 'reader-status', role: 'status', 'aria-live': 'polite' }, t('home.reader.wait'));
  const reader = h('div', { class: 'reader glass' },
    h('div', { class: 'reader-pad' }, rfidIcon()),
    h('p', { class: 'reader-name' }, t('home.reader.name')),
    status);

  const progress = Math.min(1, day / TRANSIT_DAYS);
  const mission = h('div', { class: 'mission glass' },
    h('p', null, h('strong', null, t('home.mission.day', { day })), ' · ', t('home.mission.of', { total: TRANSIT_DAYS })),
    h('div', { class: 'mission-track', 'aria-hidden': 'true' },
      h('i', { class: 'dot-earth' }),
      h('span', { class: 'mission-line' }, h('b', { style: `width:${progress * 100}%` }), h('u', { style: `left:${progress * 100}%` })),
      h('i', { class: 'dot-mars' })),
    h('p', null, t('home.mission.note')));

  const grid = h('div', { class: 'idcards' });

  function tap(card, a) {
    if (grid.classList.contains('is-busy')) return;
    grid.classList.add('is-busy');
    const go = () => {
      store.update((st) => { st.astronautId = a.id; st.onboarded = true; });
      navigate('#/chequeo');
    };
    status.textContent = t('home.reader.read', { name: a.name });
    reader.classList.add('is-reading');
    if (reducedMotion()) { timer = setTimeout(go, 350); return; }
    const pad = reader.querySelector('.reader-pad').getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const dx = pad.left + pad.width / 2 - (r.left + r.width / 2);
    const dy = pad.top + pad.height / 2 - (r.top + r.height / 2);
    card.classList.add('is-flying');
    card.style.transform = `translate(${dx}px, ${dy}px) scale(0.42) rotate(-6deg)`;
    card.style.opacity = '0';
    timer = setTimeout(go, 1250);
  }

  store.crew().forEach((a, i) => {
    const last = store.latestCheck(a.id);
    const b = a.baseline;
    const card = h('button', { class: 'idcard glass', type: 'button', 'aria-label': t('home.card.aria', { name: a.name, role: a.role }), onClick: () => tap(card, a) },
      !state.onboarded && i === 0 && h('span', { class: 'idcard-hint', 'aria-hidden': 'true' }, t('home.card.hint')),
      h('div', { class: 'idcard-top' },
        h('span', { class: 'idcard-chip', 'aria-hidden': 'true' }),
        last ? statusPill(last.analysis.status) : h('span', { class: 'idcard-rfid' }, rfidIcon(24))),
      h('div', null,
        h('p', { class: 'idcard-name' }, a.name),
        h('p', { class: 'idcard-role' }, a.role)),
      h('p', { class: 'idcard-base' },
        h('span', null, t('home.card.normal')),
        h('span', null, h('b', null, fmt(b.hr)), ' ', t('unit.bpm')),
        h('span', null, 'HRV ', h('b', null, fmt(b.hrv)), ' ', t('unit.ms')),
        h('span', null, h('b', null, fmt(b.temp, 1)), ' ', t('unit.c'))),
      h('p', { class: 'idcard-foot' },
        h('span', { class: 'idcard-uid' }, `RFID ${a.uid}`),
        h('span', null, last ? t('home.card.last', { day: last.day }) : t('home.card.never'))));
    grid.append(card);
  });

  let sensorPanel = null;
  let liveTimer = 0;
  if (isLocalBridgeLocation()) {
    const es = ctx.i18n.lang() === 'es';
    const L = (e, n) => (es ? e : n);
    const show = (value, unit, d = 1) => (Number.isFinite(value) ? `${fmt(value, d)} ${unit}` : '—');
    const cell = (label) => {
      const v = h('b', null, '—');
      const s = h('small', null, '');
      return { el: h('div', { class: 'hw-cell' }, h('span', null, label), v, s), v, s };
    };
    const cCard = cell(L('Tarjeta', 'Card'));
    const cPulse = cell(L('Pulso', 'Pulse'));
    const cSpo2 = cell(L('Oxígeno (estimado)', 'Oxygen (estimate)'));
    const cTemp = cell(L('Temperatura cabina', 'Cabin temperature'));
    const cHum = cell(L('Humedad', 'Humidity'));
    const cPress = cell(L('Presión', 'Pressure'));
    const cWatch = cell(L('Reloj · pulso', 'Watch · pulse'));
    const cSkin = cell(L('Reloj · piel', 'Watch · skin'));
    const cWSpo2 = cell(L('Reloj · SpO₂', 'Watch · SpO₂'));
    const badge = h('span', { class: 'hw-badge', hidden: true }, L('DATOS DE PRUEBA', 'TEST DATA'));
    const spo2Btn = h('button', { class: 'btn btn--glass glass btn--small', type: 'button', disabled: true, onClick: async () => {
      spo2Btn.disabled = true;
      const ok = await requestWatchSpo2().catch(() => false);
      cWSpo2.s.textContent = ok ? L('Midiendo… no muevas la muñeca (30 s)', 'Measuring… keep your wrist still (30 s)') : L('El reloj no responde', 'Watch not responding');
    } }, L('Medir SpO₂ con el reloj', 'Measure SpO₂ with the watch'));
    const status = h('p', { role: 'status', 'aria-live': 'polite' }, L('Pulsa para leer la estación en directo.', 'Press to read the station live.'));
    const QUALITY = {
      'no-finger': L('Pon el dedo en el sensor', 'Place your finger on the sensor'),
      'no-data': L('Sin señal del sensor', 'No sensor signal'),
      collecting: L('Midiendo… no muevas el dedo', 'Measuring… keep still'),
      weak: L('Señal débil: apoya mejor el dedo', 'Weak signal: press gently'),
      noisy: L('Señal con ruido: no muevas el dedo', 'Noisy signal: keep still'),
      good: L('Señal buena', 'Good signal'),
    };
    async function tick() {
      try {
        const data = await getSensorSnapshot();
        const st = data.station;
        const env = data.environment;
        cTemp.v.textContent = show(env.temperature_c, '°C');
        cHum.v.textContent = show(env.humidity_pct, '%');
        cPress.v.textContent = show(env.pressure_hpa, 'hPa');
        const crewByUid = Object.fromEntries(store.crew().map((a) => [a.uid.replace(/\s/g, ''), a.name]));
        if (st?.card) {
          cCard.v.textContent = st.card.uid;
          cCard.s.textContent = crewByUid[st.card.uid] || L(`hace ${Math.round(st.card.age_s)} s`, `${Math.round(st.card.age_s)} s ago`);
        } else { cCard.v.textContent = '—'; cCard.s.textContent = L('Acerca una tarjeta', 'Tap a card'); }
        const p = st?.pulse;
        cPulse.v.textContent = p?.bpm ? `${p.bpm} ${t('unit.bpm')}` : '—';
        cPulse.s.textContent = p ? QUALITY[p.quality] || '' : '';
        cSpo2.v.textContent = p?.spo2 ? `${p.spo2} %` : '—';
        cSpo2.s.textContent = p?.spo2 ? L('Prototipo sin calibrar', 'Uncalibrated prototype') : '';
        const where = st?.connected ? `Arduino ${st.port || ''} · ${st.firmware || L('sin firmware', 'no firmware')}` : L('Arduino no conectado', 'Arduino not connected');
        const w = data.watch;
        badge.hidden = data.source !== 'test';
        spo2Btn.disabled = !w || w.spo2_status === 'measuring';
        cWatch.v.textContent = w?.bpm ? `${w.bpm} ${t('unit.bpm')}` : '—';
        cWatch.s.textContent = w ? `${w.device || ''}${Number.isFinite(w.battery_pct) ? ` · ${w.battery_pct} %` : ''}` : L('Reloj no conectado', 'Watch not connected');
        cSkin.v.textContent = show(w?.skin_c, '°C');
        cWSpo2.v.textContent = w?.spo2 ? `${w.spo2} %` : '—';
        if (w?.spo2_status === 'measuring') cWSpo2.s.textContent = L('Midiendo… no muevas la muñeca', 'Measuring… keep still');
        else if (w?.spo2) cWSpo2.s.textContent = L('Última medición del reloj', 'Last watch reading');
        else if (!w) cWSpo2.s.textContent = '';
        status.textContent = `${where}${data.errors?.length ? ` · ${data.errors.join(' · ')}` : ''}`;
      } catch {
        status.textContent = L('Puente local no disponible. Inícialo en la Raspberry.', 'Local bridge unavailable. Start it on the Raspberry Pi.');
      }
    }
    const button = h('button', { class: 'btn btn--glass glass btn--small', type: 'button', onClick: () => {
      if (liveTimer) { clearInterval(liveTimer); liveTimer = 0; button.textContent = L('Leer en directo', 'Read live'); return; }
      tick();
      liveTimer = setInterval(tick, 1000);
      button.textContent = L('Parar', 'Stop');
    } }, L('Leer en directo', 'Read live'));
    sensorPanel = h('section', { class: 'stage glass hw-panel' },
      h('h2', { class: 'card-title' }, L('XPaze Station · lectura real', 'XPaze Station · real reading'), ' ', badge),
      h('p', null, L('Datos del Arduino por USB. Son independientes del chequeo simulado y no son un dispositivo médico.', 'Data from the Arduino over USB. Separate from the simulated check; not a medical device.')),
      h('div', { class: 'hw-grid' }, cCard.el, cPulse.el, cSpo2.el, cTemp.el, cHum.el, cPress.el, cWatch.el, cSkin.el, cWSpo2.el),
      status, h('div', { class: 'hw-actions' }, button, spo2Btn));
  }

  el.append(
    viewHead({ eyebrow: t('home.eyebrow'), title: t('home.title'), lead: t('home.lead') }),
    sensorPanel,
    h('ol', { class: 'steps', 'aria-label': t('home.steps.label') },
      h('li', { class: 'step glass is-now' }, t('home.steps.1')),
      h('li', { class: 'step glass' }, t('home.steps.2')),
      h('li', { class: 'step glass' }, t('home.steps.3'))),
    h('div', { class: 'tap' },
      h('div', { class: 'reader-col' }, reader, mission),
      grid),
    h('div', { class: 'next' },
      h('p', { class: 'next-hint' }, t('home.next.hint')),
      h('a', { class: 'btn btn--glass glass btn--small', href: '#/tripulacion' }, t('home.next.crew')),
      h('a', { class: 'btn btn--glass glass btn--small', href: '#/laboratorio' }, t('home.next.lab'))));

  return () => { clearTimeout(timer); clearInterval(liveTimer); };
}
