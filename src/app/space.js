// Clima espacial: convierte los avisos de DONKI (NASA, Community Coordinated Modeling Center)
// en un semáforo con reglas fijas y explicables, según el entorno de la misión.
// No toca el semáforo de salud: es un riesgo del entorno (HRP: Space Radiation).
//
// Entrada: eventos ya extraídos por el servidor (server/psicologa.js, /api/espacio):
//   { type: 'SEP'|'FLR'|'GST'|'RBE'|'CME'|'IPS'|'MPC', time: ISO, flare?: 'M5.0', kp?: 5.67 }
// Los avisos se detectan desde la órbita terrestre (GOES, L1, STEREO): en tránsito a Marte
// la exposición real depende de la posición de la nave. Se dice así en la app.

export const SPACE_LEVEL = ['green', 'yellow', 'red'];

const H = 3600_000;
const age = (e, now) => (now - Date.parse(e.time)) / H;

// Fuera de la magnetosfera (tránsito, Luna, superficie de Marte) los protones solares llegan sin
// filtro; en órbita baja (estación) el campo magnético protege buena parte del tiempo.
const SHIELDED = { station: true, transit: false, lunar: false, rover: false };

export function flareClass(f) {
  const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(f || '');
  if (!m) return 0;
  return { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[m[1]] * parseFloat(m[2]);
}

export function assessSpace(events = [], envKey = 'transit', now = Date.now(), lang = 'es') {
  const L = (es, en) => (lang === 'en' ? en : es);
  const shielded = !!SHIELDED[envKey];
  const reasons = [];
  let level = 0;
  const raise = (l, why) => { level = Math.max(level, l); reasons.push({ level: l, text: why }); };
  const recent = (type, hours) => events.filter((e) => e.type === type && age(e, now) >= 0 && age(e, now) <= hours);

  // Partículas solares energéticas (protones): el riesgo de radiación principal para la tripulación.
  const sep = recent('SEP', 48);
  if (sep.length) raise(shielded ? 1 : 2, shielded
    ? L('Evento de partículas solares en las últimas 48 h: en órbita baja el campo magnético protege, pero las salidas extravehiculares y las órbitas polares se exponen más.',
      'Solar particle event in the last 48 h: in low orbit the magnetic field protects you, but spacewalks (EVAs) and polar orbits are more exposed.')
    : L('Evento de partículas solares en las últimas 48 h: fuera de la magnetosfera la radiación llega sin filtro.',
      'Solar particle event in the last 48 h: outside the magnetosphere the radiation arrives unfiltered.'));

  // Fulguraciones fuertes: pueden ir seguidas de protones en horas.
  const big = recent('FLR', 24).filter((e) => flareClass(e.flare) >= flareClass('M5.0'));
  if (big.length) {
    const top = big.map((e) => e.flare).sort((a, b) => flareClass(b) - flareClass(a))[0];
    raise(shielded ? 0 : 1, L(`Fulguración solar ${top} en las últimas 24 h: pueden llegar protones energéticos en las próximas horas.`,
      `${top} solar flare in the last 24 h: energetic protons may arrive in the next few hours.`));
  }

  // Tormentas geomagnéticas: afectan a la órbita terrestre (comunicaciones, más radiación en latitudes altas).
  const gst = recent('GST', 24);
  const kp = Math.max(0, ...gst.map((e) => e.kp || 0));
  if (kp >= 7 && shielded) raise(1, L(`Tormenta geomagnética fuerte (Kp ${kp.toFixed(1)}): más radiación en los pasos por latitudes altas y posibles cortes de comunicación.`,
    `Strong geomagnetic storm (Kp ${kp.toFixed(1)}): more radiation on high-latitude passes and possible communication outages.`));
  else if (kp >= 5) raise(0, L(`Tormenta geomagnética ${kp >= 7 ? 'fuerte' : 'moderada'} (Kp ${kp.toFixed(1)}) en la órbita terrestre.`,
    `${kp >= 7 ? 'Strong' : 'Moderate'} geomagnetic storm (Kp ${kp.toFixed(1)}) in Earth orbit.`));

  // Cinturón de radiación: afecta sobre todo a satélites y a salidas largas en órbita.
  if (recent('RBE', 48).length && shielded) raise(0, L('Cinturón de radiación exterior reforzado: relevante para salidas extravehiculares largas.', 'Outer radiation belt enhancement: relevant for long spacewalks (EVAs).'));

  const ACTIONS = lang === 'en' ? {
    0: [],
    1: ['Review where the radiation shelter is and the plan to get there.', 'Avoid non-essential spacewalks (EVAs) for the next 24 h.', 'Wear your personal dosimeter and follow the alerts.'],
    2: ['Go to the radiation shelter (the most protected area, surrounded by water and equipment) and stay until the alert is lifted.', 'Suspend spacewalks and surface activities.', 'Record your dosimeter reading and report it to the flight surgeon.'],
  } : {
    0: [],
    1: ['Repasa dónde está el refugio de radiación y el plan para llegar a él.', 'Evita salidas extravehiculares no esenciales en las próximas 24 h.', 'Lleva el dosímetro personal y sigue los avisos.'],
    2: ['Ve al refugio de radiación (la zona más protegida, rodeada de agua y equipos) y quédate hasta que se levante el aviso.', 'Suspende salidas extravehiculares y de superficie.', 'Anota la dosis del dosímetro e infórmalo al cirujano de vuelo.'],
  };
  const HEAD = lang === 'en'
    ? ['No relevant alerts for the crew', 'Space weather watch', 'Radiation alert: take shelter']
    : ['Sin avisos relevantes para la tripulación', 'Vigilancia por clima espacial', 'Alerta de radiación: busca refugio'];
  const headline = level === 0 && reasons.length ? L('Sin riesgo para la tripulación · avisos informativos', 'No risk to the crew · informational alerts') : HEAD[level];
  return { level, headline, reasons, actions: ACTIONS[level], shielded };
}
