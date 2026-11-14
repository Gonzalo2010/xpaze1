// XPaze App (PWA): conecta con la estación por Bluetooth o con una simulada,
// muestra las lecturas en directo y hace chequeos que se comparan contigo.

import './app.css';
import { BleLink, SimLink, WifiLink, bluetoothAvailable, wifiAvailable } from './link.js';
import { MEASURES, ENVIRONMENTS, PHQ2, PHQ2_ANSWERS, RED_FLAGS, classify, actionPlan, cabinLevel } from './clinical.js';
import { streamAI } from './ai.js';
import { PazeOrb, bindOrbToVoice } from './paze-orb.js';
import { assessSpace } from './space.js';
import { bindOrbControls, orbLabel } from './voice.js';
import { VoiceSession, micAvailable, CRISIS } from './voice.js';
import { analyze as psychAnalyze } from '../demo/psych/engine/index.js';
import psychStrings from '../demo/psych/strings.js';
import { CMD } from './protocol.js';
import { assess, summarize, MIN_PERSONAL } from './assess.js';
import { CREW } from '../demo/core/engine/crew.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const ROLE = { 'role.commander': 'Comandante', 'role.engineer': 'Ingeniería de vuelo', 'role.medical': 'Responsable médica', 'role.scientist': 'Ciencia' };
const crewByUid = Object.fromEntries(CREW.map((c) => [c.uid.replace(/\s/g, ''), c]));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));

/* ------------------------------------------------------------ memoria -- */
const KEY = 'xpaze-app-v1';
const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const saved = store.load();
saved.healthCodes ||= {};
saved.memory ||= {};
saved.facts ||= {};
saved.about ||= {};
if (saved.healthCode) { saved.healthCodes.GONZALO ||= saved.healthCode; delete saved.healthCode; } // código de la versión anterior (era de Gonzalo)
saved.history ||= {};

/* -------------------------------------------------------------- estado -- */
const S = {
  link: null, linkState: 'idle', status: null, vitals: null, watch: null,
  person: null,        // { uid, name, role, crew }
  wave: [],            // últimas muestras de la onda
  screen: 'welcome',
  check: null,         // medición en curso
  result: null,
};
const WAVE_MAX = 150;  // 6 s a 25 muestras/s

// Perfiles reales (no son tripulación ficticia): sus datos vienen del reloj vía XPaze Link.
const REAL_PEOPLE = { GONZALO: { name: 'Gonzalo', role: 'Perfil real · Galaxy Watch', hue: 145 } };
const PEOPLE = [...CREW.map((c) => ({ uid: c.uid.replace(/\s/g, ''), name: c.name })), ...Object.entries(REAL_PEOPLE).map(([uid, p]) => ({ uid, name: p.name }))];

function personFromUid(uid) {
  if (REAL_PEOPLE[uid]) return { uid, ...REAL_PEOPLE[uid], crew: null, real: true };
  const c = crewByUid[uid];
  return c ? { uid, name: c.name, role: ROLE[c.roleKey] || '', crew: c.baseline, hue: c.hue }
    : { uid, name: `Tarjeta ${uid}`, role: 'Sin ficha de tripulación', crew: null, hue: 200 };
}

/* --------------------------------------------------------- navegación -- */
function go(screen) {
  if (S.screen === 'chat' && screen !== 'chat' && S.chat?.history?.length && !S.chat.remembered) {
    S.chat.remembered = true;
    rememberSession(S.chat.uid, S.chat.history.slice());
  }
  if (screen !== 'chat' && S.voice) S.voice.stop(); // al salir de la psicóloga se cuelga
  S.screen = screen;
  render();
  window.scrollTo({ top: 0 });
}

// Barra de pestañas a mano del pulgar en las pantallas principales.
const TABS = [['home', 'Inicio', 'home'], ['check', 'Chequeo', 'pulse'], ['chat', 'Paze', 'paze'], ['history', 'Historial', 'chart']];
function tabbar() {
  const nav = el(`<nav class="tabbar" aria-label="Secciones">${TABS.map(([k, t, ic]) => `<button data-tab="${k}" class="${S.screen === k || (k === 'home' && S.screen === 'live') ? 'is-on' : ''}" aria-current="${S.screen === k}">${icon(ic)}<span>${t}</span></button>`).join('')}</nav>`);
  nav.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tab;
    if (k === S.screen) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (k === 'check') startCheck();
    else if (k === 'chat') openChat();
    else go(k);
  }));
  return nav;
}

function render() {
  const views = { welcome, choose, connecting, home, live, check, result, history, chat };
  if (S.pazeOrb && S.screen !== 'chat') { S.pazeOrb.destroy(); S.pazeOrb = null; }
  if (S.homeOrb && S.screen !== 'home') { S.homeOrb.destroy(); S.homeOrb = null; }
  app.replaceChildren();
  app.append(views[S.screen]());
  const withTabs = S.person && ['home', 'live', 'result', 'history', 'chat'].includes(S.screen);
  document.body.classList.toggle('has-tabs', !!withTabs);
  if (withTabs) app.append(tabbar());
  updateLive();
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ------------------------------------------------------ 0 bienvenida -- */
// Lo primero es elegir quién eres. La estación simulada se conecta sola;
// la física (Bluetooth o WiFi) queda como opción secundaria.
function lastStatus(uid) {
  const h = (saved.history[uid] || []).at(-1);
  if (!h) return '<span class="pc__st">Sin chequeos todavía</span>';
  const lv = h.overall ?? ['normal', 'watch', 'alert'].indexOf(h.status);
  const when = new Date(h.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `<span class="pc__st"><span class="dot dot--${LEVEL_CLS[lv] || 'off'}"></span>Último chequeo: ${when}</span>`;
}

function welcome() {
  const node = el(`
    <section class="screen welcome">
      <header class="brandbar"><img src="/logo-mark-dark.png" alt="" width="34" height="28"/><b>XPaze</b></header>
      <h1>Hola. ¿Quién eres?</h1>
      <p class="lead">Elige tu perfil y empieza. Nada que configurar.</p>
      <div class="people">${PEOPLE.map((x) => {
        const p = personFromUid(x.uid);
        return `<button class="pc ${p.real ? 'pc--real' : ''}" data-uid="${x.uid}" style="--hue:${p.hue}">
          <span class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
          <span class="pc__txt"><b>${esc(p.name)}</b><small>${esc(p.role)}</small>${lastStatus(x.uid)}</span>
          ${p.real ? '<span class="pc__tag">Tus datos reales</span>' : ''}
        </button>`;
      }).join('')}</div>
      <button class="linkish welcome__hw" data-act="connect">${S.link && S.link.kind !== 'sim' ? `Conectado a ${esc(S.link.name)}` : 'Tengo la XPaze Station: conectar por Bluetooth o WiFi'}</button>
      <p class="fine">Prototipo de investigación. No es un dispositivo médico.</p>
    </section>`);
  node.querySelectorAll('[data-uid]').forEach((b) => b.addEventListener('click', () => enter(b.dataset.uid)));
  node.querySelector('[data-act="connect"]').onclick = () => go('choose');
  return node;
}

async function enter(uid) {
  if (!S.link) {
    const link = new SimLink();
    attach(link);
    await link.connect();
  }
  identify(uid, { quiet: true });
  go('home');
}

/* --------------------------------------------------------- 1 inicio -- */
function home() {
  const p = S.person;
  if (!p) return welcome();
  const first = p.name.split(' ')[0];
  const last = (saved.history[p.uid] || []).at(-1);
  const lv = last ? (last.overall ?? 0) : null;
  const h = S.health && !S.health.error ? S.health : null;
  const sleep = h?.sleep?.hours ?? last?.mind?.sleep ?? null;
  const sp = spaceNow();
  const hour = new Date().getHours();
  const hi = hour < 6 ? 'Buenas noches' : hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  const node = el(`
    <section class="screen homev">
      ${topbar()}
      <div class="hello" style="--hue:${p.hue}">
        <span class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>
        <div><h1>${hi}, ${esc(first)}</h1><p>${esc(p.role)} · ${esc(ENVIRONMENTS[envKey()].name)}</p></div>
      </div>

      <div class="glance">
        <div class="g"><small>Último chequeo</small><b>${last ? `<span class="dot dot--${LEVEL_CLS[lv]}"></span>${['Bien', 'A vigilar', 'Actúa'][lv]}` : '—'}</b><em>${last ? new Date(last.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : 'aún ninguno'}</em></div>
        <div class="g"><small>Sueño</small><b>${sleep != null ? `${fmt(sleep, 1)} h` : '—'}</b><em>${h?.sleep ? 'de tu reloj' : last?.mind ? 'del chequeo' : 'sin dato'}</em></div>
        <div class="g"><small>Clima espacial</small><b>${sp ? `<span class="dot dot--${LEVEL_CLS[sp.level]}"></span>${['Tranquilo', 'Vigilancia', 'Alerta'][sp.level]}` : '…'}</b><em>en directo</em></div>
      </div>

      <button class="big big--check" data-act="check">
        <span class="big__ico">${icon('pulse')}</span>
        <span><b>Hacerme un chequeo</b><small>2 minutos · te guía paso a paso</small></span>
      </button>
      <button class="big big--paze" data-act="psy">
        <span class="big__orb"></span>
        <span><b>Hablar con Paze</b><small>Tu psicóloga de a bordo · por voz o por texto</small></span>
      </button>

      <div class="minor">
        <button class="mini" data-act="datos">${icon('sim')}<span>Mis datos en directo</span></button>
        <button class="mini" data-act="history">${icon('chart')}<span>Historial</span></button>
      </div>

      <div class="envsel"><span>¿Dónde estás?</span><div class="seg seg--wrap">${Object.entries(ENVIRONMENTS).map(([k, e]) => `<button data-env="${k}" class="${k === envKey() ? 'is-on' : ''}">${e.short}</button>`).join('')}</div></div>
      <button class="linkish" data-act="switch">No soy ${esc(first)}: cambiar de persona</button>
    </section>`);
  wire(node);
  node.querySelector('[data-act="datos"]').onclick = () => go('live');
  node.querySelector('[data-act="switch"]').onclick = () => go('welcome');
  // Paze vive en el botón
  try {
    S.homeOrb?.destroy();
    S.homeOrb = new PazeOrb(node.querySelector('.big__orb'), { mood: 'calma', hr: S.vitals?.bpm || 64 });
    S.homeOrb.start();
  } catch { /* sin WebGL: el botón sigue funcionando */ }
  loadSpace().then(() => { if (S.screen === 'home' && spaceNow() && !sp) render(); });
  if (saved.healthCodes[p.uid] && !S.health) refreshHealth().then(() => { if (S.screen === 'home' && S.health && !S.health.error && !h) render(); });
  return node;
}

/* ---------------------------------------------------------- 1 elegir -- */
function choose() {
  const ble = bluetoothAvailable();
  const secure = window.isSecureContext;
  const node = el(`
    <section class="screen choose">
      <header class="brandbar"><img src="/logo-mark-dark.png" alt="" width="34" height="28"/><b>XPaze</b></header>
      <h1>Conectar la estación</h1>
      <p class="lead">Si tienes la XPaze Station encendida, conéctala por Bluetooth o por WiFi. Si no, usa la simulada.</p>
      <div class="options">
        <button class="option" data-act="ble" ${ble && secure ? '' : 'disabled'}>
          <span class="option__icon">${icon('bt')}</span>
          <span><b>Estación física</b><small>Conectar por Bluetooth con la XPaze Station</small></span>
        </button>
        <div class="remembered" hidden></div>
        <button class="option" data-act="wifi" ${wifiAvailable() ? '' : 'hidden'}>
          <span class="option__icon option__icon--wifi">${icon('wifi')}</span>
          <span><b>Estación por WiFi</b><small>Conectado a la red de la Raspberry Pi, sin Internet</small></span>
        </button>
        <button class="option" data-act="sim">
          <span class="option__icon option__icon--sim">${icon('sim')}</span>
          <span><b>Estación simulada</b><small>Sin hardware. Tú controlas la tarjeta, el dedo y el reloj</small></span>
        </button>
      </div>
      ${!secure ? '<p class="note">Bluetooth necesita una conexión segura (https). Abre la app desde su dirección https.</p>'
        : !ble ? '<p class="note">Este navegador no tiene Web Bluetooth. Usa Chrome en Android o en un ordenador. En iPhone, solo la estación simulada.</p>' : ''}
      <p class="fine">Prototipo de investigación. No es un dispositivo médico.</p>
    </section>`);
  node.querySelector('[data-act="ble"]').onclick = () => startBle();
  node.querySelector('[data-act="sim"]').onclick = () => startSim();
  node.querySelector('[data-act="wifi"]').onclick = () => startWifi();
  if (ble && secure) {
    new BleLink().remembered().then((dev) => {
      if (!dev) return;
      const box = node.querySelector('.remembered');
      box.hidden = false;
      box.append(el(`<button class="chip-btn">Reconectar con ${esc(dev.name || 'XPaze Station')}</button>`));
      box.firstChild.onclick = () => startBle(dev);
    });
  }
  return node;
}

function attach(link) {
  S.link?.disconnect();
  S.link = link;
  S.status = S.vitals = S.watch = null;
  S.wave = [];
  link.on(onEvent);
  saved.lastMode = link.kind;
  store.save(saved);
}

async function startBle(remembered) {
  const link = new BleLink();
  attach(link);
  go('connecting');
  try {
    if (remembered) await link.resume(remembered);
    else await link.choose();
    go(S.person ? 'home' : 'welcome');
  } catch (e) {
    S.link = null;
    if (e?.name === 'NotFoundError') { go('choose'); return; } // el usuario cerró el selector
    S.linkError = e?.message || String(e);
    go('connecting');
  }
}

async function startWifi() {
  const link = new WifiLink();
  attach(link);
  go('connecting');
  try { await link.connect(); go(S.person ? 'home' : 'welcome'); } catch (e) { S.link = null; S.linkError = e?.message || String(e); go('connecting'); }
}

async function startSim() {
  const link = new SimLink();
  attach(link);
  go('connecting');
  await link.connect();
  go(S.person ? 'home' : 'welcome');
}

/* ---------------------------------------------------- 2 conectando -- */
function connecting() {
  const err = S.linkError;
  S.linkError = null;
  const node = el(`
    <section class="screen center">
      ${err ? `<div class="big-icon err">${icon('x')}</div><h2>No se pudo conectar</h2>
        <p class="lead">${esc(err)}</p>
        <ul class="tips"><li>Comprueba que la Raspberry está encendida y cerca.</li><li>Activa el Bluetooth y la ubicación del móvil.</li><li>Si la estación estaba conectada a otro móvil, desconéctalo.</li></ul>
        <button class="btn btn--dark" data-act="back">Volver</button>`
      : `<div class="spinner"></div><h2>Conectando…</h2><p class="lead">${S.link?.kind === 'sim' ? 'Preparando la estación simulada.' : 'Elige «XPaze Station» en la lista de dispositivos.'}</p>`}
    </section>`);
  node.querySelector('[data-act="back"]')?.addEventListener('click', () => go('welcome'));
  return node;
}

/* ------------------------------------------------------ 3 en directo -- */
function topbar() {
  return `
    <header class="topbar">
      <img src="/logo-mark-dark.png" alt="" width="28" height="23"/>
      <span class="link-chip" data-live="chip">—</span>
      <span class="test-badge" data-live="test" hidden>Datos de prueba</span>
      <button class="icon-btn" data-act="menu" aria-label="${S.screen === 'home' ? 'Cambiar de persona' : 'Volver al inicio'}">${icon(S.screen === 'home' ? 'swap' : 'home')}</button>
    </header>`;
}

function live() {
  const p = S.person;
  const node = el(`
    <section class="screen live">
      ${topbar()}
      <button class="linkish back" data-act="home">← Volver al inicio</button>
      <h2 class="screen-t">Mis datos en directo</h2>
      <div class="person ${p ? '' : 'is-empty'}" style="--hue:${p?.hue ?? 200}">
        ${p ? `<div class="avatar">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</div>
          <div><b>${esc(p.name)}</b><small>${esc(p.role)}</small></div>
          <button class="chip-btn" data-act="history">Historial</button>`
        : `<div class="avatar avatar--card">${icon('card')}</div><div><b>Acerca tu tarjeta al lector</b><small>O elige quién eres</small></div>
          <select class="who" aria-label="Elegir astronauta"><option value="">Elegir…</option>${PEOPLE.map((c) => `<option value="${c.uid}">${esc(c.name)}</option>`).join('')}</select>`}
      </div>

      <div class="wavebox">
        <div class="wavebox__head"><span>Onda de pulso</span><span data-live="quality">—</span></div>
        <canvas class="wave" data-live="wave" aria-hidden="true"></canvas>
      </div>

      <div class="tiles">
        <div class="tile tile--hr"><small>Pulso</small><b data-live="bpm">—</b><em>lpm</em></div>
        <div class="tile"><small>Oxígeno estimado</small><b data-live="spo2">—</b><em>%</em></div>
      </div>

      <div class="envsel"><span>Entorno</span><div class="seg seg--wrap">${Object.entries(ENVIRONMENTS).map(([k, e]) => `<button data-env="${k}" class="${k === envKey() ? 'is-on' : ''}">${e.short}</button>`).join('')}</div></div>
      <button class="btn btn--dark btn--block" data-act="check" ${p ? '' : 'disabled'}>Empezar chequeo guiado</button>
      ${p ? '<button class="btn btn--line btn--block" data-act="psy">Hablar con la psicóloga (IA)</button>' : ''}
      ${p ? '' : '<p class="hint">Identifícate para empezar un chequeo.</p>'}

      <h3 class="section-t">Cabina</h3>
      <div class="tiles tiles--3">
        <div class="tile tile--sm"><small>Temperatura</small><b data-live="temp">—</b><em>°C</em></div>
        <div class="tile tile--sm"><small>Humedad</small><b data-live="hum">—</b><em>%</em></div>
        <div class="tile tile--sm"><small>Presión</small><b data-live="press">—</b><em>hPa</em></div>
      </div>
      <p class="fine" data-live="cabin">Límites de cabina según el estándar NASA-STD-3001.</p>

      <h3 class="section-t">Clima espacial · DONKI (NASA)</h3>
      <div class="spacebox" data-live="space">${spaceBox()}</div>

      <h3 class="section-t">Reloj · Samsung Health</h3>
      <div class="shealth" data-live="shealth">${healthBox()}</div>
      <h3 class="section-t">Reloj · en directo</h3>
      <div class="watch" data-live="watchbox">
        <div class="tiles tiles--3">
          <div class="tile tile--sm"><small>Pulso</small><b data-live="wbpm">—</b><em>lpm</em></div>
          <div class="tile tile--sm"><small>Piel</small><b data-live="wskin">—</b><em>°C</em></div>
          <div class="tile tile--sm"><small>SpO₂</small><b data-live="wspo2">—</b><em>%</em></div>
        </div>
        <div class="watch__foot"><span data-live="wstate">—</span><button class="chip-btn" data-act="wspo2">Medir SpO₂ (30 s)</button></div>
      </div>

      <div class="sensors" data-live="sensors"></div>
      ${S.link?.kind === 'sim' ? simPanel() : ''}
    </section>`);
  wire(node);
  node.querySelector('[data-act="home"]').onclick = () => go('home');
  return node;
}

function simPanel() {
  return `
    <details class="sim" open>
      <summary>Controles de la estación simulada</summary>
      <div class="sim__row"><span>Tarjeta</span>
        <div class="seg">${PEOPLE.map((c) => `<button data-sim-card="${c.uid}">${esc(c.name.split(' ')[0])}</button>`).join('')}</div></div>
      <div class="sim__row"><span>Dedo en el sensor</span><button class="switch" data-sim="finger" aria-pressed="false"><i></i></button></div>
      <div class="sim__row"><span>Reloj conectado</span><button class="switch" data-sim="watch" aria-pressed="true"><i></i></button></div>
      <div class="sim__row"><span>Situación</span>
        <div class="seg seg--wrap">
          <button data-sim-prof="rest" class="is-on">Reposo</button>
          <button data-sim-prof="exercise">Tras entrenar</button>
          <button data-sim-prof="fever">Fiebre</button>
          <button data-sim-prof="lowo2">Oxígeno bajo</button>
        </div></div>
    </details>`;
}

const PROFILES = {
  rest: () => ({ bpm: S.person?.crew?.hr ?? 64, spo2: 98 }),
  exercise: () => ({ bpm: 112, spo2: 97 }),
  fever: () => ({ bpm: (S.person?.crew?.hr ?? 64) + 24, spo2: 96 }),
  lowo2: () => ({ bpm: (S.person?.crew?.hr ?? 64) + 6, spo2: 91 }),
};

function wire(node) {
  node.querySelector('[data-act="menu"]')?.addEventListener('click', () => go(S.screen === 'home' ? 'welcome' : 'home'));
  node.querySelector('[data-act="check"]')?.addEventListener('click', startCheck);
  node.querySelector('[data-act="history"]')?.addEventListener('click', () => go('history'));
  if (node.querySelector('[data-live="space"]')) loadSpace();
  const hb = node.querySelector('[data-live="shealth"]');
  if (hb) { wireHealth(hb); if (saved.healthCodes[S.person?.uid] && !S.health) refreshHealth(); }
  node.querySelector('[data-act="psy"]')?.addEventListener('click', () => openChat());
  node.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => {
    saved.env = b.dataset.env; store.save(saved);
    node.querySelectorAll('[data-env]').forEach((x) => x.classList.toggle('is-on', x === b));
    toast(`Entorno: ${ENVIRONMENTS[saved.env].name}. Comunicación con Tierra: ${ENVIRONMENTS[saved.env].delay}.`);
    const sb = node.querySelector('[data-live="space"]'); if (sb) sb.innerHTML = spaceBox();
  }));
  node.querySelector('.who')?.addEventListener('change', (e) => { if (e.target.value) identify(e.target.value); });
  node.querySelector('[data-act="wspo2"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const ok = await S.link?.send(CMD.watchSpo2);
    toast(ok ? 'Midiendo SpO₂ en el reloj. No muevas la muñeca 30 s.' : 'El reloj no responde.');
  });
  // simulación
  // los perfiles reales no tienen tarjeta RFID (su UID no es hexadecimal): se identifican directamente
  node.querySelectorAll('[data-sim-card]').forEach((b) => b.addEventListener('click', () => (REAL_PEOPLE[b.dataset.simCard] ? identify(b.dataset.simCard) : S.link.tapCard(b.dataset.simCard))));
  node.querySelector('[data-sim="finger"]')?.addEventListener('click', (e) => {
    const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); S.link.setFinger(on);
  });
  node.querySelector('[data-sim="watch"]')?.addEventListener('click', (e) => {
    const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on); S.link.setWatch(on);
  });
  node.querySelectorAll('[data-sim-prof]').forEach((b) => b.addEventListener('click', () => {
    node.querySelectorAll('[data-sim-prof]').forEach((x) => x.classList.toggle('is-on', x === b));
    S.link.setProfile(PROFILES[b.dataset.simProf]());
  }));
}

function identify(uid, { quiet = false } = {}) {
  const changed = S.person?.uid !== uid;
  S.person = personFromUid(uid);
  if (changed) { S.health = null; S.chat = null; }
  if (S.link?.kind === 'sim') S.link.setProfile(PROFILES.rest());
  if (changed) {
    vibrate(40);
    if (!quiet) toast(`Hola, ${S.person.name.split(' ')[0]}.`);
    if (['live', 'home'].includes(S.screen)) render();
  }
}

/* --------------------------------------------- eventos de la estación -- */
function onEvent({ type, data }) {
  if (type === 'link') {
    S.linkState = data.state;
    if (data.state === 'disconnected' && !['choose', 'welcome'].includes(S.screen)) { S.link = null; toast('Estación desconectada.'); go(S.person ? 'home' : 'welcome'); return; }
  } else if (type === 'vitals') {
    S.vitals = data;
    if (S.check && STEPS[S.check.step] === 'hr' && !S.check.manual) S.check.samples.push({
      bpm: data.quality === 'good' ? data.bpm : null, spo2: data.quality === 'good' ? data.spo2 : null,
      quality: data.quality, temperature: data.temperature, humidity: data.humidity, pressure: data.pressure,
      watchBpm: S.watch?.bpm ?? null, skin: S.watch?.skin ?? null,
    });
  } else if (type === 'wave') {
    S.wave.push(...data.samples);
    if (S.wave.length > WAVE_MAX) S.wave.splice(0, S.wave.length - WAVE_MAX);
    return; // el lienzo se pinta en su propio bucle
  } else if (type === 'card') {
    if (data && S.screen === 'welcome') enter(data.uid);
    else if (data && ['home', 'live', 'history', 'result'].includes(S.screen)) identify(data.uid);
  } else if (type === 'watch') {
    S.watch = data;
  } else if (type === 'status') {
    S.status = data;
  }
  updateLive();
}

const QUALITY_TEXT = {
  'no-data': 'Sin señal del sensor', 'no-finger': 'Pon el dedo en el sensor', collecting: 'Midiendo… no te muevas',
  weak: 'Señal débil: apoya mejor el dedo', noisy: 'Hay movimiento: quédate quieto', good: 'Señal buena',
};

function setText(key, text) { const n = app.querySelector(`[data-live="${key}"]`); if (n && n.textContent !== text) n.textContent = text; }

function updateLive() {
  const v = S.vitals; const w = S.watch; const st = S.status;
  const chip = app.querySelector('[data-live="chip"]');
  if (chip) {
    const map = { connected: ['Conectado', 'ok'], connecting: ['Conectando…', 'warn'], reconnecting: ['Reconectando…', 'warn'], disconnected: ['Desconectado', 'err'], idle: ['—', ''] };
    const [txt, cls] = map[S.linkState] || map.idle;
    chip.textContent = `${S.link?.kind === 'sim' ? 'Simulada' : S.link?.name || 'Estación'} · ${txt}`;
    chip.className = `link-chip ${cls}`;
  }
  const test = app.querySelector('[data-live="test"]');
  if (test) test.hidden = !(st?.test && S.link?.kind === 'ble');
  setText('bpm', v?.bpm ? String(v.bpm) : '—');
  setText('spo2', v?.spo2 ? String(v.spo2) : '—');
  setText('quality', v ? QUALITY_TEXT[v.quality] || '' : 'Esperando datos…');
  app.querySelector('.tile--hr')?.classList.toggle('is-good', v?.quality === 'good');
  setText('temp', fmt(v?.temperature, 1));
  setText('hum', fmt(v?.humidity, 0));
  setText('press', fmt(v?.pressure, 0));
  const cab = v ? cabinLevel(v) : null;
  const cabEl = app.querySelector('[data-live="cabin"]');
  if (cabEl && cab != null) {
    const t = ['Aire de cabina dentro de los límites de NASA-STD-3001.', 'Aire de cabina fuera del rango de confort (NASA-STD-3001 V2 6013).', 'Aire de cabina fuera de los límites de salud (NASA-STD-3001 V2 6012): avisa a la tripulación.'][cab];
    if (cabEl.textContent !== t) { cabEl.textContent = t; cabEl.className = `fine cab-${['ok', 'warn', 'err'][cab]}`; }
  }
  setText('wbpm', w?.bpm ? String(w.bpm) : '—');
  setText('wskin', fmt(w?.skin, 1));
  setText('wspo2', w?.spo2 ? String(w.spo2) : '—');
  setText('wstate', !w ? 'Reloj no conectado' : w.spo2Measuring ? 'Midiendo SpO₂… no muevas la muñeca' : `Conectado${w.battery != null ? ` · batería ${w.battery} %` : ''}`);
  const wbtn = app.querySelector('[data-act="wspo2"]');
  if (wbtn) wbtn.disabled = !w || w.spo2Measuring;
  app.querySelector('[data-live="watchbox"]')?.classList.toggle('is-off', !w);
  const sens = app.querySelector('[data-live="sensors"]');
  if (sens && st) {
    const items = [['Arduino', st.arduino], ['Tarjetas', st.rfid], ['Pulso', st.ppg], ['Temp./humedad', st.aht], ['Presión', st.bmp], ['Reloj', st.watch]];
    const html = items.map(([n, ok]) => `<span class="${ok ? 'ok' : 'off'}">${n}</span>`).join('');
    if (sens.innerHTML !== html) sens.innerHTML = html;
  }
  if (S.screen === 'check') updateCheck();
}

/* ---------------------------------------------------------- onda -- */
function drawWave() {
  const c = app.querySelector('canvas.wave');
  if (c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const data = S.wave;
    const good = S.vitals?.quality === 'good' || S.vitals?.quality === 'collecting';
    g.strokeStyle = 'rgba(20,20,20,0.08)';
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    if (data.length > 2) {
      const peak = Math.max(200, ...data.map(Math.abs));
      g.lineWidth = 2.4; g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = good ? '#e5484d' : '#a5a29b';
      g.beginPath();
      data.forEach((v, i) => {
        const x = (i / (WAVE_MAX - 1)) * w;
        const y = h / 2 - (v / peak) * (h * 0.42);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
      const lx = ((data.length - 1) / (WAVE_MAX - 1)) * w;
      const ly = h / 2 - (data[data.length - 1] / peak) * (h * 0.42);
      g.fillStyle = good ? '#e5484d' : '#a5a29b';
      g.beginPath(); g.arc(lx, ly, 3.5, 0, Math.PI * 2); g.fill();
    }
  }
  requestAnimationFrame(drawWave);
}
requestAnimationFrame(drawWave);

/* ------------------------------------------------- 4 chequeo guiado -- */
// Cinco pasos: pulso y SpO₂ (sensor o a mano) · tensión · glucosa · ánimo y sueño · señales de alarma.
const CHECK_S = 30;
const CHECK_MAX_S = 60;
const CHECK_GOOD = 15;
const STEPS = ['hr', 'bp', 'glucose', 'mind', 'flags'];
const STEP_TITLE = { hr: 'Pulso y oxígeno', bp: 'Tensión arterial', glucose: 'Glucosa', mind: 'Ánimo y sueño', flags: 'Señales de alarma' };
const envKey = () => (ENVIRONMENTS[saved.env] ? saved.env : 'transit');

async function startCheck() {
  if (!S.person) return;
  S.check = { step: 0, samples: [], start: performance.now(), uid: S.person.uid, values: {}, manual: false, done: false };
  try { S.check.lock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
  go('check');
  S.check.timer = setInterval(updateCheck, 250);
}

function stepIntro(id) {
  const m = MEASURES[id === 'hr' ? 'hr' : id];
  const i = STEPS.indexOf(id);
  return `
    <p class="kicker">Paso ${i + 1} de ${STEPS.length} · ${esc(S.person.name)}</p>
    <div class="dots">${STEPS.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('')}</div>
    <h2>${STEP_TITLE[id]}</h2>
    ${m ? `<details class="why"><summary>¿Por qué se mide?</summary><p>${esc(m.why)}</p>
      ${id === 'hr' ? `<p>${esc(MEASURES.spo2.why)}</p>` : ''}</details>
      <ol class="howto">${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}`;
}

function check() {
  const c = S.check;
  const id = STEPS[c.step];
  const views = { hr: stepHr, bp: stepBp, glucose: stepGlucose, mind: stepMind, flags: stepFlags };
  const node = views[id]();
  node.querySelector('[data-act="cancel"]')?.addEventListener('click', () => { if (confirm('¿Cancelar el chequeo? No se guardará.')) { endCheck(); go('home'); } });
  node.querySelector('[data-act="menu"]').onclick = () => {};
  return node;
}

function nextStep() {
  if (S.link?.kind === 'sim' && STEPS[S.check.step] === 'hr') S.link.setFinger(false);
  S.check.step += 1;
  if (S.check.step >= STEPS.length) finishCheck();
  else go('check');
}

const footer = (skip = true, label = 'Siguiente') => `
  <div class="row">
    ${skip ? '<button class="btn btn--line" data-act="skip">Omitir</button>' : '<button class="btn btn--line" data-act="cancel">Cancelar</button>'}
    <button class="btn btn--dark" data-act="next">${label}</button>
  </div>
  ${skip ? '<button class="btn btn--ghost btn--block" data-act="cancel">Cancelar chequeo</button>' : ''}`;

function numberField(name, label, unit, { min, max, step = 1, value = '', required = true }) {
  return `<label class="field"><span>${label}</span><span class="field__in"><input name="${name}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}"${required ? ' required' : ''}/><em>${unit}</em></span></label>`;
}
const readNum = (node, name, min, max) => {
  const v = parseFloat(node.querySelector(`[name="${name}"]`)?.value);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
};

function stepHr() {
  const c = S.check;
  if (S.link?.kind === 'sim' && !c.manual) S.link.setFinger(true);
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('hr')}
      <div class="sensor-box" ${c.manual ? 'hidden' : ''}>
        <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring__bg"/><circle cx="60" cy="60" r="52" class="ring__fg" pathLength="100"/></svg>
          <div class="ring__in"><b data-live="cbpm">—</b><small>lpm</small></div></div>
        <h3 class="check__msg" data-live="cmsg">Pon el dedo en el sensor</h3>
        <div class="wavebox"><canvas class="wave" aria-hidden="true"></canvas></div>
        <button class="btn btn--ghost btn--block" data-act="manual">El sensor no funciona: introducir a mano</button>
      </div>
      <form class="manual" ${c.manual ? '' : 'hidden'}>
        <p class="note">Medida manual: usa el pulsioxímetro de la enfermería y anota lo que marque.</p>
        ${numberField('hr', 'Pulso en reposo', 'lpm', { min: 25, max: 230 })}
        ${numberField('spo2', 'Oxígeno (SpO₂), opcional', '%', { min: 50, max: 100, required: false })}
        <button class="btn btn--dark btn--block" type="submit">Siguiente</button>
      </form>
      <button class="btn btn--line btn--block" data-act="cancel">Cancelar chequeo</button>
    </section>`);
  node.querySelector('[data-act="manual"]').onclick = () => { c.manual = true; go('check'); };
  node.querySelector('form.manual').onsubmit = (e) => {
    e.preventDefault();
    const hr = readNum(node, 'hr', 25, 230);
    if (hr == null) { toast('Escribe un pulso válido.'); return; }
    c.values.hr = Math.round(hr);
    const sp = readNum(node, 'spo2', 50, 100);
    if (sp != null) c.values.spo2 = Math.round(sp);
    c.values.manualHr = true;
    nextStep();
  };
  return node;
}

function stepBp() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('bp')}
      <div class="fields2">
        ${numberField('sys', 'Alta (sistólica)', 'mmHg', { min: 50, max: 260 })}
        ${numberField('dia', 'Baja (diastólica)', 'mmHg', { min: 30, max: 160 })}
      </div>
      ${footer()}
    </section>`);
  node.querySelector('[data-act="skip"]').onclick = nextStep;
  node.querySelector('[data-act="next"]').onclick = () => {
    const sys = readNum(node, 'sys', 50, 260), dia = readNum(node, 'dia', 30, 160);
    if (sys == null || dia == null || dia >= sys) { toast('Revisa los dos valores: la alta debe ser mayor que la baja.'); return; }
    S.check.values.bp = { sys: Math.round(sys), dia: Math.round(dia) };
    nextStep();
  };
  return node;
}

function stepGlucose() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('glucose')}
      ${numberField('glu', 'Glucosa', 'mg/dL', { min: 20, max: 600 })}
      <label class="check-row"><input type="checkbox" name="fasting"/> <span>Estoy en ayunas (más de 8 h sin comer)</span></label>
      ${footer()}
    </section>`);
  node.querySelector('[data-act="skip"]').onclick = nextStep;
  node.querySelector('[data-act="next"]').onclick = () => {
    const g = readNum(node, 'glu', 20, 600);
    if (g == null) { toast('Escribe un valor de glucosa entre 20 y 600 mg/dL.'); return; }
    S.check.values.glucose = Math.round(g);
    S.check.values.fasting = node.querySelector('[name="fasting"]').checked;
    nextStep();
  };
  return node;
}

function stepMind() {
  const a = { q0: null, q1: null };
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('mind')}
      ${PHQ2.map((q, i) => `<fieldset class="q"><legend>En las últimas dos semanas: ${esc(q.toLowerCase())}</legend>
        <div class="seg seg--wrap seg--left">${PHQ2_ANSWERS.map((t, v) => `<button type="button" data-q="${i}" data-v="${v}">${t}</button>`).join('')}</div></fieldset>`).join('')}
      ${numberField('sleep', 'Horas dormidas esta noche', 'h', { min: 0, max: 16, step: 0.5, value: S.health?.sleep?.hours != null ? Math.round(S.health.sleep.hours * 2) / 2 : 7 })}
      ${S.health?.sleep?.hours != null ? `<p class="fine">Según tu reloj (Samsung Health): ${fmt(S.health.sleep.hours, 1)} h. Corrígelo si no es así.</p>` : ''}
      <label class="field"><span>Estrés hoy: <b data-live="stressv">3</b> de 10</span><input name="stress" type="range" min="0" max="10" step="1" value="3"/></label>
      ${footer(false)}
    </section>`);
  node.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    a[`q${b.dataset.q}`] = +b.dataset.v;
    node.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach((x) => x.classList.toggle('is-on', x === b));
  }));
  const range = node.querySelector('[name="stress"]');
  range.oninput = () => { node.querySelector('[data-live="stressv"]').textContent = range.value; };
  node.querySelector('[data-act="next"]').onclick = () => {
    if (a.q0 == null || a.q1 == null) { toast('Responde a las dos preguntas.'); return; }
    const sleep = readNum(node, 'sleep', 0, 16);
    if (sleep == null) { toast('Escribe las horas de sueño.'); return; }
    S.check.values.mind = { phq2: a.q0 + a.q1, sleep, stress: +range.value };
    nextStep();
  };
  return node;
}

function stepFlags() {
  const node = el(`
    <section class="screen check">
      ${topbar()}
      ${stepIntro('flags')}
      <p class="lead">¿Notas ahora alguna de estas señales? Si es así, no esperes al resultado: avisa a la tripulación.</p>
      <div class="flags">${RED_FLAGS.map((f, i) => `<label class="check-row check-row--flag"><input type="checkbox" value="${i}"/> <span>${esc(f)}</span></label>`).join('')}</div>
      ${footer(false, 'Ver resultado')}
    </section>`);
  node.querySelector('[data-act="next"]').onclick = () => {
    S.check.values.flags = [...node.querySelectorAll('.flags input:checked')].map((x) => RED_FLAGS[+x.value]);
    nextStep();
  };
  return node;
}

function updateCheck() {
  const c = S.check;
  if (!c || S.screen !== 'check' || STEPS[c.step] !== 'hr' || c.manual || c.done) return;
  const elapsed = (performance.now() - c.start) / 1000;
  const good = c.samples.filter((s) => s.bpm != null).length;
  const progress = Math.min(1, Math.min(1, good / CHECK_GOOD) * Math.min(1, elapsed / CHECK_S));
  const fg = app.querySelector('.ring__fg');
  if (fg) fg.style.strokeDashoffset = String(100 - progress * 100);
  const v = S.vitals;
  setText('cbpm', v?.bpm && v.quality === 'good' ? String(v.bpm) : '—');
  setText('cmsg', v ? (v.quality === 'good' ? `Midiendo… ${Math.max(0, Math.ceil(CHECK_S - elapsed))} s` : QUALITY_TEXT[v.quality]) : 'Esperando a la estación…');
  if ((good >= CHECK_GOOD && elapsed >= CHECK_S) || elapsed >= CHECK_MAX_S) {
    c.done = true;
    const r = summarize(c.samples);
    if (r.bpm == null) {
      toast('No hubo señal estable. Introduce el pulso a mano.');
      c.manual = true; c.done = false; go('check');
      return;
    }
    Object.assign(c.values, { hr: r.bpm, spo2: r.spo2 ?? undefined, watchBpm: r.watchBpm, skin: r.skin, cabin: { t: r.temperature, h: r.humidity, p: r.pressure } });
    vibrate(60);
    toast(`Pulso ${r.bpm} lpm${r.spo2 ? ` · SpO₂ ${r.spo2} %` : ''}. Siguiente paso.`);
    nextStep();
  }
}

function endCheck() {
  if (S.link?.kind === 'sim') S.link.setFinger(false);
  if (!S.check) return;
  clearInterval(S.check.timer);
  S.check.lock?.release?.().catch(() => {});
  S.check = null;
}

function finishCheck() {
  const c = S.check;
  const v = c.values;
  endCheck();
  const list = saved.history[c.uid] || [];
  const results = [];
  if (v.hr != null) {
    const r = classify('hr', v.hr);
    // la línea base personal puede subir a amarillo; el rojo solo lo dan los umbrales absolutos
    const p = assess({ bpm: v.hr, spo2: null }, { history: list.filter((h) => h.bpm), crew: S.person?.crew });
    if (r.level === 0 && p.z != null && Math.abs(p.z) >= 2.5) {
      r.level = 1;
      r.reason = `${v.hr} lpm está en rango general, pero lejos de tu normal (${p.baseline.hr} lpm).`;
    }
    results.push({ ...r, display: `${v.hr} lpm${v.manualHr ? ' (manual)' : ''}` });
  }
  if (v.spo2 != null) results.push({ ...classify('spo2', v.spo2), display: `${v.spo2} %` });
  if (v.bp) results.push({ ...classify('bp', v.bp), display: `${v.bp.sys}/${v.bp.dia} mmHg` });
  if (v.glucose != null) results.push({ ...classify('glucose', v.glucose), display: `${v.glucose} mg/dL${v.fasting ? ' en ayunas' : ''}` });
  if (v.mind) results.push({ ...classify('mind', v.mind), display: `PHQ-2 ${v.mind.phq2}/6 · ${fmt(v.mind.sleep, 1)} h · estrés ${v.mind.stress}/10` });
  const plan = actionPlan(results, envKey());
  const flags = v.flags || [];
  const overall = flags.length ? 2 : plan.worst;
  const entry = {
    at: Date.now(), env: envKey(), bpm: v.hr ?? null, spo2: v.spo2 ?? null, bp: v.bp || null, glucose: v.glucose ?? null,
    mind: v.mind || null, flags, overall, status: ['normal', 'watch', 'alert'][overall],
    sim: S.link?.kind === 'sim' || !!S.status?.test,
  };
  if (results.length) { saved.history[c.uid] = [...list, entry].slice(-200); store.save(saved); }
  S.result = { results, plan, flags, overall, entry, explanation: null };
  vibrate(overall === 0 ? 60 : [80, 80, 80]);
  go('result');
}

/* ------------------------------------------------------- 5 resultado -- */
const LEVEL_TXT = ['Verde · todo en rango', 'Amarillo · a vigilar', 'Rojo · actúa ahora'];
const LEVEL_CLS = ['ok', 'warn', 'err'];

function result() {
  const { results, plan, flags, overall, entry } = S.result;
  const env = ENVIRONMENTS[entry.env];
  const node = el(`
    <section class="screen result">
      ${topbar()}
      <p class="kicker">${esc(S.person?.name || '')} · ${esc(env.name)} · ${new Date(entry.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
      ${flags.length ? `<div class="emergency" role="alert"><b>Señal de alarma</b><p>Has marcado: ${esc(flags.join(', ').toLowerCase())}.</p>
        <p>Avisa ahora a la tripulación y al oficial médico. ${esc(env.ground)}</p>
        ${flags.includes('Pensamientos de hacerte daño') ? '<p>No te quedes solo. Habla con alguien de la tripulación ahora mismo. En la Tierra: 112 o 024.</p>' : ''}</div>` : ''}
      <div class="verdict verdict--${LEVEL_CLS[overall]}"><span></span>${LEVEL_TXT[overall]}</div>
      <div class="ai-box">
        <div class="ai-box__head"><span class="ai-badge">IA</span><b>Lo que significa</b></div>
        <p class="ai-text" data-live="ai">Preparando la explicación…</p>
        <small>El semáforo lo deciden umbrales fijos; la IA solo lo explica.</small>
      </div>
      <h3 class="section-t">Tus medidas</h3>
      <ul class="results">${results.map((r) => `
        <li class="lvl-${LEVEL_CLS[r.level]}"><span class="dot dot--${LEVEL_CLS[r.level]}"></span>
          <div><b>${esc(r.name)}</b><small>${esc(r.reason)}</small></div><em>${esc(r.display)}</em></li>`).join('') || '<li class="empty">No se ha medido nada.</li>'}</ul>


      ${overall > 0 ? `<div class="plan">
        <h3>Qué hacer ahora</h3>
        <ul>${plan.now.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Tripulación</h3><p>${esc(plan.crew)}</p>
        <h3>Cirujano de vuelo</h3><p>${esc(plan.surgeon)}</p>
        ${plan.evac || flags.length ? `<h3>Si empeora</h3><p>${esc(env.evac)}</p>` : ''}
        <p class="fine">Comunicación con Tierra en este entorno: ${esc(env.delay)}.</p>
      </div>` : `<p class="lead">${esc(plan.crew)} ${esc(plan.surgeon)}</p>`}

      ${(() => { const a = spaceNow(); return a && a.level > 0 ? `<div class="plan plan--space"><h3>Clima espacial (DONKI · NASA)</h3><p><b>${esc(a.headline)}.</b> ${esc(a.reasons.filter((r) => r.level > 0).map((r) => r.text).join(' '))}</p><ul>${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="fine">Es un riesgo del entorno: no cambia el color de tu chequeo.</p></div>` : ''; })()}
      ${entry.sim ? '<p class="note">Chequeo hecho con datos simulados.</p>' : ''}
      <div class="row">
        <button class="btn btn--dark" data-act="psy">Hablar con la psicóloga</button>
        <button class="btn btn--line" data-act="history">Historial</button>
      </div>
      <button class="btn btn--ghost btn--block" data-act="home">Volver al inicio</button>
      <p class="fine">XPaze no diagnostica. Las cifras de referencia y sus fuentes están en la tabla médica del proyecto.</p>
    </section>`);
  node.querySelector('[data-act="psy"]').onclick = () => openChat();
  node.querySelector('[data-act="history"]').onclick = () => go('history');
  node.querySelector('[data-act="home"]').onclick = () => go('home');
  wire(node);
  explain(node);
  return node;
}

async function explain(node) {
  const R = S.result;
  const out = node.querySelector('[data-live="ai"]');
  if (R.explanation) { out.textContent = R.explanation; return; }
  const env = ENVIRONMENTS[R.entry.env];
  try {
    R.explanation = await streamAI('explicar', { check: {
      person: S.person?.name, environment: `${env.name} (${env.gravity}; retardo con Tierra ${env.delay})${spaceNow()?.level ? `. Clima espacial: ${spaceNow().headline}` : ''}`,
      overall: R.overall, simulated: R.entry.sim,
      results: R.results.map((r) => ({ name: r.name, display: r.display, level: r.level, reason: r.reason })),
      plan: { now: R.plan.now, crew: R.plan.crew, surgeon: R.plan.surgeon, evac: R.plan.evac },
    } }, (t) => { out.textContent = t; });
  } catch {
    out.textContent = 'La IA no está disponible ahora mismo (sin conexión con el servidor). El semáforo y la guía de esta pantalla son válidos igualmente.';
    out.classList.add('is-off');
  }
}

/* ---------------------------------------------------- psicóloga (IA) -- */
// Contexto único para la psicóloga (texto y voz): todo lo que la app sabe de la persona.
// Nunca incluye el diario de Mente.
function mindSummary(uid) {
  try {
    const demo = JSON.parse(localStorage.getItem('xpaze-demo-v1') || 'null');
    const crew = crewByUid[uid];
    if (!demo?.psych || !crew || !demo.psych[crew.id]) return [];
    const r = psychAnalyze({ psych: demo.psych, missionDay: demo.day }, crew.id, { day: demo.day });
    const tr = (k, vars = {}) => (psychStrings.es[k] || k).replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? ''));
    return [`estado ${tr(r.label)}`, ...r.factors.map((f) => tr(f.key, f.vars))];
  } catch { return []; }
}

/* ------------------------------------------------ Samsung Health (XPaze Link) -- */
// La app Android XPaze Link sube lo que Samsung Health sincroniza en Health Connect
// bajo un código de 8 caracteres. Aquí se vincula ese código y se leen los datos.
S.health = null;
let healthTimer = 0;

// En un entrenamiento el reloj mide cada segundo: la media de todas las muestras se dispara.
// La mediana de las medias horarias refleja mejor el día.
function hrTypical(h) {
  const v = (h?.heartRate?.hourly || []).map((x) => x.bpm).sort((a, b) => a - b);
  if (!v.length) return h?.heartRate?.avg ?? null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');

function healthBox() {
  const code = saved.healthCodes[S.person?.uid];
  if (!code) {
    return `<p class="fine">Instala XPaze Link en el móvil emparejado con el reloj y escribe aquí su código.</p>
      <div class="compose"><input class="code-in" maxlength="9" placeholder="Código (8 caracteres)" autocapitalize="characters" autocomplete="off" aria-label="Código de XPaze Link"/><button class="btn btn--dark" data-act="hlink">Vincular</button></div>`;
  }
  const h = S.health;
  if (!h) return `<p class="fine">Buscando datos del código ${esc(code)}…</p><button class="chip-btn" data-act="hunlink">Desvincular</button>`;
  if (h.error) return `<p class="fine">${esc(h.error)}</p><button class="chip-btn" data-act="hunlink">Cambiar código</button>`;
  const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };
  const tiles = [
    ['Pulso', h.heartRate?.last, 'lpm', h.heartRate && `a las ${hhmm(h.heartRate.lastAt)} · típico ${hrTypical(h)}`],
    ['En reposo', h.restingHeartRate?.bpm, 'lpm'],
    ['HRV', h.hrv?.rmssdMs != null ? Math.round(h.hrv.rmssdMs) : null, 'ms'],
    ['SpO₂', h.spo2?.pct != null ? Math.round(h.spo2.pct) : null, '%'],
    ['Sueño', h.sleep?.hours, 'h'],
    ['Pasos hoy', h.stepsToday, ''],
  ].filter(([, v]) => v != null);
  return `<div class="tiles tiles--3">${tiles.map(([n, v, u, sub]) => `<div class="tile tile--sm"><small>${n}</small><b>${esc(String(v))}</b><em>${u}</em>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`).join('') || '<p class="fine">Aún sin datos en Health Connect.</p>'}</div>
    <p class="fine">Datos reales del reloj vía Samsung Health · recibidos ${ago(h.receivedAt)} · <button class="linkish" data-act="hunlink">desvincular</button></p>`;
}

async function refreshHealth() {
  clearTimeout(healthTimer);
  const code = saved.healthCodes[S.person?.uid];
  if (!code) return;
  try {
    const r = await fetch(new URL(`api/salud/${code}`, location.href), { cache: 'no-store' });
    S.health = r.ok ? await r.json() : { error: r.status === 404 ? 'Todavía no hay datos con ese código. Abre XPaze Link en el móvil y pulsa «Leer y enviar ahora».' : `Error ${r.status} al leer los datos.` };
  } catch {
    S.health = { error: 'Sin conexión con el servidor de XPaze.' };
  }
  const box = app.querySelector('[data-live="shealth"]');
  if (box) { box.innerHTML = healthBox(); wireHealth(box); }
  healthTimer = setTimeout(refreshHealth, 60_000);
}

function wireHealth(root) {
  root.querySelector('[data-act="hlink"]')?.addEventListener('click', () => {
    const v = root.querySelector('.code-in').value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!/^[2-9A-HJ-NP-Z]{8}$/.test(v)) { toast('El código tiene 8 caracteres, como en XPaze Link.'); return; }
    saved.healthCodes[S.person?.uid] = v; store.save(saved); S.health = null;
    root.innerHTML = healthBox(); wireHealth(root); refreshHealth();
  });
  root.querySelectorAll('[data-act="hunlink"]').forEach((b) => b.addEventListener('click', () => {
    delete saved.healthCodes[S.person?.uid]; store.save(saved); S.health = null; clearTimeout(healthTimer);
    root.innerHTML = healthBox(); wireHealth(root);
  }));
}

function healthContext() {
  const h = S.health;
  if (!h || h.error) return null;
  return Object.fromEntries(Object.entries({
    'Pulso último (lpm)': h.heartRate ? `${h.heartRate.last} a las ${hhmm(h.heartRate.lastAt)}` : null, 'Pulso típico del día (mediana por horas)': hrTypical(h), 'Pulso mín–máx 24 h (el máximo suele ser de ejercicio)': h.heartRate ? `${h.heartRate.min}–${h.heartRate.max}` : null,
    'Pulso en reposo': h.restingHeartRate?.bpm, 'HRV RMSSD (ms)': h.hrv?.rmssdMs != null ? Math.round(h.hrv.rmssdMs) : null,
    'SpO₂ (%)': h.spo2?.pct != null ? Math.round(h.spo2.pct) : null, 'Sueño de anoche (h)': h.sleep?.hours,
    'Respiración (rpm)': h.respiratoryRate?.rpm != null ? Math.round(h.respiratoryRate.rpm * 10) / 10 : null,
    'Temperatura (°C)': h.bodyTemperature?.c, 'Pasos hoy': h.stepsToday,
  }).filter(([, v]) => v != null));
}

/* ------------------------------------------------ clima espacial (DONKI) -- */
S.space = null;
let spaceAt = 0;
async function loadSpace() {
  if (S.space && Date.now() - spaceAt < 10 * 60_000) return;
  spaceAt = Date.now();
  try {
    const r = await fetch(new URL('api/espacio', location.href), { cache: 'no-store' });
    S.space = r.ok ? await r.json() : { error: true };
  } catch { S.space = { error: true }; }
  const box = app.querySelector('[data-live="space"]');
  if (box) box.innerHTML = spaceBox();
}
const spaceNow = () => (S.space && !S.space.error ? assessSpace(S.space.events, envKey()) : null);

function spaceBox() {
  if (!S.space) return '<p class="fine">Consultando los avisos de clima espacial…</p>';
  if (S.space.error) return '<p class="fine">No se han podido leer los avisos de clima espacial ahora mismo.</p>';
  const a = spaceNow();
  const ago = Math.round((Date.now() - Date.parse(S.space.fetchedAt)) / 60_000);
  return `<div class="spacecard lvl-${LEVEL_CLS[a.level]}">
    <p class="spacecard__head"><span class="dot dot--${LEVEL_CLS[a.level]}"></span><b>${esc(a.headline)}</b></p>
    ${a.reasons.slice(0, 3).map((r) => `<p class="fine">${esc(r.text)}</p>`).join('')}
    ${a.actions.length ? `<ul>${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="fine">Entorno: ${esc(ENVIRONMENTS[envKey()].name)}. Avisos de los últimos 7 días, detectados desde la órbita terrestre${envKey() === 'transit' ? '; en tránsito la exposición real depende de la posición de la nave' : ''}. Actualizado hace ${ago < 60 ? `${Math.max(ago, 1)} min` : `${Math.round(ago / 60)} h`}${S.space.stale ? ' (copia anterior)' : ''}.</p>
  </div>`;
}

/* ------------------------------------------------ memoria de Paze (solo en este dispositivo) -- */
async function rememberSession(uid, messages) {
  if (!uid || messages.filter((m) => m.role === 'user').length < 2) return;
  try {
    const r = await fetch(new URL('api/psicologa/resumen', location.href), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }),
    });
    if (!r.ok) return;
    const { summary, facts = [] } = await r.json();
    if (!summary) return;
    saved.memory[uid] = [...(saved.memory[uid] || []), { at: Date.now(), summary }].slice(-6);
    const known = saved.facts[uid] || [];
    for (const f of facts) if (f && !known.some((k) => k.toLowerCase() === f.toLowerCase())) known.push(f);
    saved.facts[uid] = known.slice(-20);
    store.save(saved);
    toast('Paze recordará lo que habéis hablado.');
  } catch { /* sin memoria esta vez */ }
}

// Lectura previa: los datos ya interpretados en frases, para que Paze no reciba números sueltos.
function buildInsights() {
  const out = [];
  const h = S.health && !S.health.error ? S.health : null;
  const env = ENVIRONMENTS[envKey()];
  const hourNow = new Date().getHours();
  if (h?.sleep?.hours != null) {
    const sh = h.sleep.hours;
    out.push(`Sueño de anoche (reloj): ${sh} h ${sh < 6 ? '— por debajo de lo recomendado (7 h o más); puede pesar en el ánimo, la paciencia y la atención' : sh < 7 ? '— algo corto' : '— suficiente'}.`);
  }
  if (h?.heartRate) {
    const typ = hrTypical(h);
    const rest = h.restingHeartRate?.bpm;
    out.push(`Pulso del día (reloj): típico ${typ} lpm${rest ? `, en reposo ${rest} lpm` : ''}, último ${h.heartRate.last} lpm a las ${hhmm(h.heartRate.lastAt)}; máximo ${h.heartRate.max} (probablemente ejercicio).`);
    if (rest && typ - rest > 25) out.push('El pulso típico del día está bastante por encima del de reposo: día activo o tensión sostenida; conviene preguntar, no suponer.');
  }
  if (h?.hrv?.rmssdMs != null) out.push(`Variabilidad cardiaca (HRV) más reciente: ${Math.round(h.hrv.rmssdMs)} ms; una HRV baja sostenida se asocia a estrés o cansancio.`);
  if (h?.spo2?.pct != null) out.push(`Oxígeno (reloj): ${Math.round(h.spo2.pct)} %${h.spo2.pct < 95 ? ' — algo bajo, revisar con la estación' : ''}.`);
  if (h?.stepsToday != null) out.push(`Actividad: ${h.stepsToday.toLocaleString('es-ES')} pasos hoy${h.stepsToday > 12000 ? ' (día muy activo: puede haber cansancio físico)' : h.stepsToday < 3000 ? ' (día muy sedentario)' : ''}.`);
  const v = S.vitals;
  if (v) {
    const cab = cabinLevel(v);
    if (cab != null) out.push(`Aire de cabina: ${v.temperature != null ? `${v.temperature.toFixed(1)} °C` : ''}${v.humidity != null ? `, ${Math.round(v.humidity)} % de humedad` : ''} — ${['dentro de los límites de NASA-STD-3001', 'fuera del rango de confort (puede influir en el descanso y el humor)', 'fuera de los límites de salud'][cab]}.`);
  }
  out.push(`Entorno: ${env.name} (${env.gravity}); un mensaje a Tierra tarda ${env.delay}: el apoyo humano de Tierra no es inmediato.`);
  const sp = spaceNow();
  if (sp) out.push(`Clima espacial real (DONKI, NASA): ${sp.headline.toLowerCase()}${sp.level ? ` — ${sp.reasons.filter((r) => r.level > 0).map((r) => r.text).join(' ')} Una alerta de radiación puede generar tensión o sensación de encierro; es normal` : ''}.`);
  const r = S.result;
  if (r) out.push(`Último chequeo: ${LEVEL_TXT[r.overall]}${r.results.filter((x) => x.level > 0).length ? ` por ${r.results.filter((x) => x.level > 0).map((x) => x.name.toLowerCase()).join(', ')}` : ''}.`);
  const hist = (saved.history[S.person?.uid] || []).filter((x) => x.mind);
  if (hist.length >= 3) {
    const last3 = hist.slice(-3).map((x) => x.mind.sleep);
    if (last3.every((x) => x < 7)) out.push(`Tres chequeos seguidos con poco sueño (${last3.join(', ')} h): patrón sostenido, no un mal día.`);
  }
  out.push(`Ahora es ${hourNow >= 22 || hourNow < 6 ? 'de noche: prioriza el descanso y no abras temas largos' : hourNow < 12 ? 'por la mañana' : hourNow < 20 ? 'por la tarde' : 'última hora de la tarde'}.`);
  return out;
}

function buildContext() {
  const p = S.person;
  const env = ENVIRONMENTS[envKey()];
  const r = S.result;
  const hist = (saved.history[p?.uid] || []).slice(-14);
  const COLOR = ['verde', 'amarillo', 'rojo'];
  const day = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const v = S.vitals, w = S.watch;
  const live = v ? Object.fromEntries(Object.entries({
    'Pulso (lpm)': v.quality === 'good' ? v.bpm : null, 'SpO₂ (%)': v.quality === 'good' ? v.spo2 : null,
    'Señal del sensor': v.quality, 'Cabina °C': v.temperature != null ? Math.round(v.temperature * 10) / 10 : null,
    'Humedad %': v.humidity != null ? Math.round(v.humidity) : null, 'Presión hPa': v.pressure != null ? Math.round(v.pressure) : null,
  }).filter(([, x]) => x != null)) : null;
  const watch = w ? Object.fromEntries(Object.entries({ 'Pulso del reloj': w.bpm, 'Piel °C': w.skin, 'SpO₂ del reloj': w.spo2, 'Batería %': w.battery }).filter(([, x]) => x != null)) : null;
  return {
    name: p?.name, role: p?.role,
    environment: `${env.name} (${env.gravity}; retardo con Tierra ${env.delay})`,
    status: r ? LEVEL_TXT[r.overall] : null,
    factors: r ? r.results.filter((x) => x.level > 0).map((x) => x.reason) : [],
    lastCheck: r ? [...r.results.map((x) => `${x.name}: ${x.display} → ${COLOR[x.level]} (${x.reason})`), ...(r.flags.length ? [`Señales de alarma marcadas: ${r.flags.join(', ')}`] : [])] : [],
    lastCheckAt: r ? new Date(r.entry.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null,
    plan: r && r.overall > 0 ? [...r.plan.now, r.plan.crew, r.plan.surgeon] : [],
    history: hist.map((h) => [
      day(h.at), h.bpm != null && `pulso ${h.bpm}`, h.bp && `tensión ${h.bp.sys}/${h.bp.dia}`, h.glucose != null && `glucosa ${h.glucose}`,
      h.mind && `sueño ${h.mind.sleep} h, PHQ-2 ${h.mind.phq2}, estrés ${h.mind.stress}`, `→ ${COLOR[h.overall ?? 0]}`,
    ].filter(Boolean).join(', ')),
    live, watch, samsung: healthContext(),
    insights: buildInsights(),
    about: saved.about[p?.uid] || '',
    facts: saved.facts[p?.uid] || [],
    memory: (saved.memory[p?.uid] || []).map((m) => `${new Date(m.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}: ${m.summary}`),
    localTime: new Date().toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
    profile: p?.real ? 'real' : 'simulado',
    today: r?.entry.mind ? { 'Horas de sueño': r.entry.mind.sleep, 'Estrés (0–10)': r.entry.mind.stress, 'PHQ-2 (0–6)': r.entry.mind.phq2 } : {},
    mind: mindSummary(p?.uid),
    simulated: !p?.real && (S.link?.kind === 'sim' || !!S.status?.test || hist.some((h) => h.sim)),
  };
}

function openChat() {
  S.chat ||= { uid: S.person?.uid, history: [] };
  if (S.chat.uid !== S.person?.uid) S.chat = { uid: S.person?.uid, history: [] };
  go('chat');
}

const ORB_STATE = {
  idle: 'Pulsa para hablar', connecting: 'Conectando…', listening: 'Te escucho', user: 'Te escucho…',
  thinking: 'Pensando…', speaking: 'Hablando', error: 'No se pudo conectar',
};

function chat() {
  const C = S.chat;
  saved.chatMode ||= 'voz';
  const voice = saved.chatMode === 'voz';
  const node = el(`
    <section class="screen chatv">
      ${topbar()}
      <div class="chat-top">
        <p class="kicker">Paze · psicóloga de a bordo (IA)</p>
        <div class="seg"><button data-mode="voz" class="${voice ? 'is-on' : ''}">Voz</button><button data-mode="texto" class="${voice ? '' : 'is-on'}">Texto</button></div>
      </div>
      <p class="ai-notice">Estás hablando con una IA. No es una persona ni sustituye a un profesional.</p>
      <div class="crisis-box" role="alert" hidden><b>Si estás en peligro, no esperes.</b><p>Habla ahora con el oficial médico o el comandante. En la Tierra: 112, o 024 en España (gratis, 24 h).</p></div>
      ${voice ? `
      <div class="voice">
        <button class="vorb vorb--paze" data-state="idle" aria-label="Empezar a hablar con Paze, la psicóloga de a bordo">
          <span class="paze-host"></span>
        </button>
        <p class="vorb__label" aria-live="polite">${ORB_STATE.idle}</p>
        <label class="noisy"><input type="checkbox" data-act="noisy" ${saved.noisy ? 'checked' : ''}/> <span>Sala con ruido: mantén pulsado el orbe para hablar</span></label>
        <div class="captions" aria-live="polite"><p class="cap cap--me"></p><p class="cap cap--ai"></p></div>
        <div class="row voice__ctl" hidden>
          <button class="btn btn--line" data-act="mute">Silenciar micro</button>
          <button class="btn btn--dark" data-act="hang">Colgar</button>
        </div>
        <p class="fine voice__note">${micAvailable() ? 'Conoce tus datos de XPaze (chequeos, historial, constantes y Mente) para entenderte mejor; nunca tu diario. No se guarda nada de la conversación.' : 'Este navegador no deja usar el micrófono aquí (hace falta https). Usa el modo texto.'}</p>
      </div>` : `
      <div class="chat-list" role="log" aria-live="polite">
        <div class="msg msg--ai"><p>Hola${S.person ? `, ${esc(S.person.name.split(' ')[0])}` : ''}. Soy Paze, la psicóloga de a bordo. ${(saved.memory[S.person?.uid] || []).length ? 'Me alegra verte de nuevo. ' : ''}Puedes contarme cómo estás, qué te preocupa o simplemente desahogarte. ¿Cómo te encuentras hoy?</p></div>
        ${C.history.map((m) => `<div class="msg msg--${m.role === 'user' ? 'me' : 'ai'}"><p>${esc(m.content)}</p></div>`).join('')}
      </div>
      <div class="chips-row">${['Últimamente duermo fatal', 'Me siento lejos de todos', 'He discutido con un compañero'].map((s) => `<button class="chip-btn" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="compose"><textarea rows="2" maxlength="2000" placeholder="Escribe lo que quieras contar…" aria-label="Mensaje"></textarea><button class="btn btn--dark" data-act="send">Enviar</button></div>
      <p class="fine">Es una IA de apoyo: no diagnostica ni receta. Al salir, guarda en este dispositivo un resumen breve para recordar la sesión; nunca tu diario.</p>`}
      ${memoryBox()}
      <button class="btn btn--ghost btn--block" data-act="home">Volver</button>
    </section>`);
  const crisis = node.querySelector('.crisis-box');
  const flagCrisis = (text) => { if (CRISIS.test(text)) crisis.hidden = false; };
  node.querySelector('[data-act="forget"]')?.addEventListener('click', () => {
    if (!confirm('¿Borrar lo que Paze recuerda de tus sesiones anteriores?')) return;
    delete saved.memory[S.person?.uid]; delete saved.facts[S.person?.uid]; store.save(saved); render();
  });
  node.querySelector('[data-act="about"]')?.addEventListener('input', (e) => {
    saved.about[S.person?.uid] = e.target.value.slice(0, 1500); store.save(saved);
  });
  node.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === saved.chatMode) return;
    S.voice?.stop();
    saved.chatMode = b.dataset.mode; store.save(saved); render();
  }));
  node.querySelector('[data-act="home"]').onclick = () => { S.voice?.stop(); go(S.result ? 'result' : 'home'); };
  wire(node);
  if (voice) wireVoice(node, flagCrisis);
  else wireText(node, C, flagCrisis);
  return node;
}

function memoryBox() {
  const uid = S.person?.uid;
  const mem = saved.memory[uid] || [];
  const facts = saved.facts[uid] || [];
  return `<details class="memory"><summary>Lo que Paze sabe de ti${mem.length || facts.length ? ` (${facts.length} datos · ${mem.length} sesiones)` : ''}</summary>
    <label class="about"><span>Sobre mí (opcional): cómo prefieres que te hable, qué te ayuda, qué te preocupa…</span>
      <textarea rows="3" maxlength="1500" data-act="about" placeholder="Ej.: prefiero que vaya al grano; me ayuda salir a correr; estos días me preocupa la presentación.">${esc(saved.about[uid] || '')}</textarea></label>
    ${facts.length ? `<p class="fine"><b>Lo que ha aprendido de ti</b></p><ul>${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${mem.length ? `<p class="fine"><b>Sesiones anteriores</b></p><ul>${mem.slice().reverse().map((m) => `<li><small>${new Date(m.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>${esc(m.summary)}</li>`).join('')}</ul>` : ''}
    <p class="fine">Todo esto se guarda solo en este dispositivo.</p>
    ${mem.length || facts.length ? '<button class="chip-btn" data-act="forget">Olvidar todo</button>' : ''}</details>`;
}

function wireVoice(node, flagCrisis) {
  const orb = node.querySelector('.vorb');
  const label = node.querySelector('.vorb__label');
  const ctl = node.querySelector('.voice__ctl');
  const capMe = node.querySelector('.cap--me');
  const capAi = node.querySelector('.cap--ai');
  S.pazeOrb?.destroy();
  const paze = new PazeOrb(orb.querySelector('.paze-host'), { mood: 'calma', hr: S.vitals?.bpm || 64 });
  paze.start();
  S.pazeOrb = paze;
  const bind = bindOrbToVoice(paze);
  const setState = (st) => { orb.dataset.state = st; label.textContent = orbLabel(st, S.voice, ORB_STATE); ctl.hidden = st === 'idle' || st === 'error'; bind.state(st); };
  const transcript = [];
  bindOrbControls(orb, () => S.voice);
  node.querySelector('[data-act="noisy"]').addEventListener('change', (e) => {
    saved.noisy = e.target.checked; store.save(saved);
    S.voice?.setPushToTalk(saved.noisy);
    if (S.voice) setState(S.voice.state);
  });
  orb.onclick = async () => {
    if (S.voice && !S.voice.ended) {
      if (!S.voice.ptt && (S.voice.state === 'speaking' || S.voice.state === 'thinking')) S.voice.interrupt();
      return;
    }
    transcript.length = 0;
    capMe.textContent = ''; capAi.textContent = '';
    const v = new VoiceSession({
      context: buildContext,
      onState: setState,
      onLevel: (l) => { orb.style.setProperty('--lvl', l.toFixed(3)); bind.level(l); },
      onCaption: ({ who, text, final }) => {
        if (who === 'me') { capMe.textContent = text; flagCrisis(text); } else capAi.textContent = text;
        if (final && text) transcript.push({ role: who === 'me' ? 'user' : 'assistant', content: text });
      },
      onEnd: (reason) => { if (reason) { label.textContent = reason; } S.voice = null; rememberSession(S.person?.uid, transcript.slice()); },
    });
    S.voice = v;
    try {
      await v.start();
      label.dataset.mode = v.mode;
      if (saved.noisy) { v.setPushToTalk(true); setState(v.state); }
    } catch (e) {
      v.stop();
      setState('error');
      label.textContent = e?.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Actívalo o usa el modo texto.' : (e?.message || 'No se pudo conectar.');
    }
  };
  node.querySelector('[data-act="hang"]').onclick = () => S.voice?.stop('Conversación terminada.');
  node.querySelector('[data-act="mute"]').onclick = (e) => {
    if (!S.voice) return;
    const m = !S.voice.muted;
    S.voice.setMuted(m);
    e.currentTarget.textContent = m ? 'Activar micro' : 'Silenciar micro';
  };
}

function wireText(node, C, flagCrisis) {
  const list = node.querySelector('.chat-list');
  const input = node.querySelector('textarea');
  const send = node.querySelector('[data-act="send"]');
  const add = (role, text) => { const d = el(`<div class="msg msg--${role}"><p></p></div>`); d.firstChild.textContent = text; list.append(d); d.scrollIntoView({ block: 'end' }); return d; };
  async function ask(text) {
    if (!text || send.disabled) return;
    flagCrisis(text);
    C.history.push({ role: 'user', content: text });
    add('me', text);
    input.value = '';
    const out = add('ai', '');
    out.classList.add('is-typing');
    send.disabled = true;
    try {
      const reply = await streamAI('psicologa', { messages: C.history, context: buildContext() }, (t) => { out.firstChild.textContent = t; });
      C.history.push({ role: 'assistant', content: reply });
    } catch (e) {
      C.history.pop();
      out.firstChild.textContent = e.message === 'rate' ? 'Has enviado muchos mensajes seguidos. Espera unos minutos.' : 'Ahora mismo no puedo conectar con la psicóloga. Habla con el oficial médico o escribe en tu diario.';
      out.classList.add('is-off');
    } finally {
      out.classList.remove('is-typing');
      send.disabled = false;
    }
  }
  send.onclick = () => ask(input.value.trim());
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value.trim()); } };
  node.querySelectorAll('[data-say]').forEach((b) => { b.onclick = () => ask(b.dataset.say); });
  requestAnimationFrame(() => list.lastElementChild?.scrollIntoView({ block: 'end' }));
}

/* -------------------------------------------------------- 6 historial -- */
// En la estación simulada, si alguien no tiene historial, se rellenan 12 días de ejemplo.
function seedHistory(uid) {
  if (S.link?.kind !== 'sim' || (saved.history[uid] || []).length) return;
  const base = crewByUid[uid]?.baseline?.hr ?? 64;
  let s = uid.split('').reduce((a, ch) => a + ch.charCodeAt(0), 7);
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const day = 86400000;
  saved.history[uid] = Array.from({ length: 12 }, (_, i) => {
    const late = i >= 9; // los últimos días, peor sueño y pulso algo más alto
    const bpm = Math.round(base + (rnd() - 0.5) * 5 + (late ? 6 + i - 9 : 0));
    const sys = Math.round(116 + (rnd() - 0.5) * 10), dia = Math.round(74 + (rnd() - 0.5) * 8);
    const mind = { phq2: late ? 2 : Math.round(rnd()), sleep: late ? 5.5 : 6.5 + Math.round(rnd() * 2) / 2, stress: late ? 6 : 3 + Math.round(rnd() * 2) };
    const levels = [classify('hr', bpm).level, classify('bp', { sys, dia }).level, classify('mind', mind).level];
    const overall = Math.max(...levels);
    return { at: Date.now() - (12 - i) * day, env: envKey(), bpm, spo2: 97 + Math.round(rnd() * 2), bp: { sys, dia }, glucose: Math.round(88 + rnd() * 25), mind, flags: [], overall, status: ['normal', 'watch', 'alert'][overall], sim: true };
  });
  store.save(saved);
}

function history() {
  const p = S.person;
  seedHistory(p?.uid);
  const list = (saved.history[p?.uid] || []).slice().reverse();
  const asc = list.slice().reverse();
  const charts = [
    ['Pulso en reposo (lpm)', asc.map((h) => h.bpm), p?.crew?.hr],
    ['Tensión sistólica (mmHg)', asc.map((h) => h.bp?.sys ?? null), 120],
    ['Horas de sueño', asc.map((h) => h.mind?.sleep ?? null), 7],
  ].filter(([, v]) => v.filter((x) => x != null).length >= 2);
  const node = el(`
    <section class="screen hist">
      ${topbar()}
      <p class="kicker">Historial y tendencias</p>
      <h2>${esc(p?.name || '')}</h2>
      ${charts.map(([t, v, ref]) => `<div class="trend"><small>${t}</small>${spark(v, ref)}</div>`).join('')}
      <p class="lead">${list.length >= MIN_PERSONAL ? `Tu pulso ya se compara con tu propia línea base (${list.length} chequeos).` : `Con ${MIN_PERSONAL} chequeos, XPaze compara tu pulso contigo. Llevas ${list.length}.`}</p>
      <ul class="hlist">${list.map((h) => `
        <li><span class="dot dot--${LEVEL_CLS[h.overall ?? ['normal', 'watch', 'alert'].indexOf(h.status)] || 'off'}"></span>
          <span><b>${h.bpm ?? '—'} lpm</b>${h.bp ? ` · ${h.bp.sys}/${h.bp.dia}` : ''}${h.glucose ? ` · ${h.glucose} mg/dL` : ''}${h.sim ? ' · <i>simulado</i>' : ''}</span>
          <small>${new Date(h.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>`).join('') || '<li class="empty">Aún no hay chequeos.</li>'}</ul>
      <div class="row">
        <button class="btn btn--dark" data-act="home">Volver</button>
        ${list.length ? '<button class="btn btn--line" data-act="clear">Borrar historial</button>' : ''}
      </div>
    </section>`);
  node.querySelector('[data-act="home"]').onclick = () => go('home');
  node.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
    if (!confirm(`¿Borrar los ${list.length} chequeos de ${p.name}? No se puede deshacer.`)) return;
    saved.history[p.uid] = [];
    store.save(saved);
    render();
  });
  wire(node);
  return node;
}

function spark(raw, ref) {
  const values = raw.map((v) => (v == null ? null : +v));
  const ok = values.filter((v) => v != null);
  const W = 320, H = 80, pad = 8;
  const lo = Math.min(...ok, ref ?? Infinity) - 3, hi = Math.max(...ok, ref ?? -Infinity) + 3;
  const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const pts = values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendencia">
    ${ref ? `<line x1="${pad}" x2="${W - pad}" y1="${y(ref)}" y2="${y(ref)}" class="spark__ref"/>` : ''}
    <path d="${d}" class="spark__line"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" class="spark__dot"/>`).join('')}</svg>`;
}

/* ------------------------------------------------------------ varios -- */
let toastTimer = 0;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('<div class="toast" role="status" aria-live="polite"></div>'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2800);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* sin vibración */ } }

function icon(name) {
  const p = {
    bt: '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
    sim: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 10h2l1.5-3 3 6L15 10h2"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    paze: '<circle cx="12" cy="12" r="5"/><path d="M4.5 9.5a8 8 0 0 1 15 0M4.5 14.5a8 8 0 0 0 15 0"/>',
    chart: '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  }[name];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
}

render();
