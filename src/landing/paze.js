// Paze en la landing: el orbe WebGL real (src/app/paze-orb.js) con una conversación
// guionizada corta que se escribe al llegar. Solo se anima mientras está en pantalla.

import { PazeOrb } from '../app/paze-orb.js';

const SCRIPT = [
  { who: 'paze', mood: 'atencion', text: 'Buenas noches, Lía. Tu reloj marca cuatro noches durmiendo menos y hoy hay aviso de clima espacial. No es una alarma: ¿cómo lo estás llevando?' },
  { who: 'me', text: 'Agotada. Y en el refugio me agobio.' },
  { who: 'paze', mood: 'empatia', text: 'Tiene todo el sentido: poco sueño y horas de encierro pesan a cualquiera. ¿Probamos algo pequeño? Un minuto respirando 4 y 6, aquí conmigo.' },
];

// Amplitud de «boca» por letra, para que el orbe se mueva al «hablar».
function amp(ch) {
  if (/[aáeéoóuú]/i.test(ch)) return 0.7 + Math.random() * 0.3;
  if (/[iíy]/i.test(ch)) return 0.45 + Math.random() * 0.2;
  if (/[mbp]/i.test(ch)) return 0.05;
  if (/[a-zñ]/i.test(ch)) return 0.25 + Math.random() * 0.15;
  return ch === ' ' ? 0.1 : 0;
}

export function initPaze(root, { reduced = false, onEnter } = {}) {
  const host = root.querySelector('.paze__orb');
  const log = root.querySelector('.paze__log');
  const moods = [...root.querySelectorAll('[data-mood]')];
  const orb = new PazeOrb(host, { mood: 'escucha', ripple: 1, hr: 62 });
  let timers = [];
  let manual = false;
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const setMood = (m) => {
    orb.setMood(m);
    moods.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mood === m)));
  };
  moods.forEach((b) => b.addEventListener('click', () => { manual = true; setMood(b.dataset.mood); }));

  function bubble(who) {
    const d = document.createElement('div');
    d.className = `pmsg pmsg--${who}`;
    log.append(d);
    return d;
  }

  function speak(el, text, done) {
    if (reduced) { el.textContent = text; done?.(); return; }
    let i = 0;
    orb.speaking = true;
    const step = () => {
      if (i >= text.length) { orb.speaking = false; orb.speechAmp = 0; done?.(); return; }
      const ch = text[i++];
      el.textContent = text.slice(0, i);
      orb.speechAmp = amp(ch);
      later(step, /[.,;?¿!¡:]/.test(ch) ? 190 : 26);
    };
    step();
  }

  function play() {
    timers.forEach(clearTimeout); timers = [];
    log.replaceChildren();
    manual = false;
    setMood('escucha');
    let t = 700;
    SCRIPT.forEach((line) => {
      later(() => {
        const el = bubble(line.who);
        if (line.who === 'me') { el.textContent = line.text; return; }
        if (!manual) setMood(line.mood);
        speak(el, line.text, () => { if (!manual) setMood('escucha'); });
      }, t);
      t += line.who === 'me' ? 1300 : line.text.length * 30 + 1600;
    });
  }

  let played = false;
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) {
      orb.start();
      if (!played) { played = true; play(); onEnter?.(); }
    } else orb.stop();
  }, { threshold: 0.25 });
  io.observe(root);
  return { replay: play };
}
