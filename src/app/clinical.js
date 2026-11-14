// Fuente única de verdad clínica de la app: umbrales fijos y explicables, pasos de
// cada medición, por qué se mide, entornos y guía de actuación.
// El semáforo SIEMPRE sale de aquí (reglas fijas). La IA solo lo explica.
// docs/medical-thresholds.md (inglés) documenta estas mismas cifras con sus fuentes.

export const LEVEL = ['green', 'yellow', 'red'];

/* -------------------------------------------------------------- entornos -- */

export const ENVIRONMENTS = {
  transit: {
    name: 'Nave en tránsito a Marte', short: 'Tránsito', gravity: 'microgravedad',
    delay: 'de 3 a 22 minutos por trayecto', ground: 'El cirujano de vuelo en Tierra tardará entre 6 y 45 minutos en contestar: actúa primero a bordo.',
    evac: 'No hay evacuación posible: el tratamiento se hace a bordo.',
  },
  station: {
    name: 'Estación orbital', short: 'Estación', gravity: 'microgravedad',
    delay: 'menos de 1 segundo', ground: 'Puedes hablar con el cirujano de vuelo casi en tiempo real.',
    evac: 'El regreso de emergencia a la Tierra es posible en horas.',
  },
  lunar: {
    name: 'Base lunar', short: 'Base lunar', gravity: '1/6 de la gravedad terrestre',
    delay: 'unos 1,3 segundos por trayecto', ground: 'El cirujano de vuelo responde casi en tiempo real.',
    evac: 'El regreso a la Tierra lleva días: estabiliza a bordo.',
  },
  rover: {
    name: 'Rover de superficie', short: 'Rover', gravity: 'gravedad parcial',
    delay: 'depende de la base (minutos si estás en Marte)', ground: 'Avisa primero a la base; ella contacta con el cirujano de vuelo.',
    evac: 'Detén la actividad y vuelve al vehículo presurizado o al hábitat.',
  },
};

/* ---------------------------------------------------------- mediciones -- */
// band(value) → { level: 0|1|2, reason } con umbrales absolutos.

export const MEASURES = {
  hr: {
    name: 'Pulso en reposo', unit: 'lpm', source: 'sensor',
    hrp: 'Cardiovascular', range: { green: '51–90', yellow: '41–50 · 91–130', red: '≤ 40 · ≥ 131' }, ref: 'NEWS2 (Royal College of Physicians, 2017)',
    why: 'El pulso en reposo es el indicador más sencillo del estado del corazón. En microgravedad el corazón trabaja con menos carga y los fluidos suben hacia la cabeza; si el pulso en reposo sube sin esfuerzo, puede deberse a fiebre, deshidratación, estrés o falta de sueño.',
    steps: [
      'Descansa dos minutos sin hablar. En microgravedad, sujeta los pies en los anclajes.',
      'Pasa tu tarjeta por el lector para que la medida vaya a tu historial.',
      'Agarra los dos asideros y apoya el pulgar derecho en la ventanita, sin apretar.',
      'Quédate quieto unos 30 segundos, hasta que la app diga «Señal buena».',
    ],
    band(v) {
      if (v <= 40) return { dir: 'low', level: 2, reason: `${v} lpm es muy bajo en reposo (≤ 40).` };
      if (v >= 131) return { dir: 'high', level: 2, reason: `${v} lpm es muy alto en reposo (≥ 131).` };
      if (v <= 50) return { dir: 'low', level: 1, reason: `${v} lpm es bajo en reposo (41–50).` };
      if (v >= 91) return { dir: 'high', level: 1, reason: `${v} lpm es alto en reposo (91–130).` };
      return { level: 0, reason: `${v} lpm está en rango en reposo (51–90).` };
    },
  },
  spo2: {
    name: 'Oxígeno en sangre (SpO₂)', unit: '%', source: 'sensor',
    hrp: 'Medical Conditions · Hypoxia', range: { green: '≥ 96', yellow: '92–95', red: '≤ 91' }, ref: 'NEWS2 escala 1; manual de pulsioximetría de la OMS (2011)',
    why: 'Indica cuánto oxígeno llevan los glóbulos rojos. Una bajada puede señalar un problema respiratorio o un fallo del aire de la cabina, y en una nave lo segundo afecta a toda la tripulación. Ojo: es una estimación de un prototipo sin calibrar.',
    steps: [
      'Se mide a la vez que el pulso, con el pulgar en la ventanita del asidero derecho.',
      'Ten la mano caliente y relajada: con frío la lectura es peor.',
      'No muevas el dedo hasta terminar.',
    ],
    band(v) {
      if (v <= 91) return { dir: 'low', level: 2, reason: `${v} % es bajo (≤ 91 %).` };
      if (v <= 95) return { dir: 'low', level: 1, reason: `${v} % está algo bajo (92–95 %).` };
      return { level: 0, reason: `${v} % es normal (≥ 96 %).` };
    },
  },
  bp: {
    name: 'Tensión arterial', unit: 'mmHg', source: 'manual',
    hrp: 'Cardiovascular (incluye intolerancia ortostática)', range: { green: '101–129 / < 80', yellow: '130–179 / 80–119 · sistólica 91–100', red: '≥ 180 / ≥ 120 · sistólica ≤ 90' }, ref: 'ACC/AHA 2017; NEWS2 (sistólica ≤ 90); NHLBI (hipotensión < 90/60)',
    why: 'En microgravedad la sangre se redistribuye hacia la cabeza y el pecho, y la tensión cambia. Al volver a la gravedad aparece la intolerancia ortostática: mareo o desmayo al ponerse de pie. Vigilarla ayuda a prevenir ambas cosas.',
    steps: [
      'Coloca el manguito en el brazo izquierdo, a la altura del corazón.',
      'Descansa cinco minutos sin hablar ni cruzar las piernas (en microgravedad, sujeto a los anclajes).',
      'Mide dos veces, con un minuto de separación.',
      'Escribe aquí la media de las dos medidas: la alta (sistólica) y la baja (diastólica).',
    ],
    band({ sys, dia }) {
      if (sys >= 180 || dia >= 120) return { dir: 'high', level: 2, reason: `${sys}/${dia} mmHg es muy alta (≥ 180 o ≥ 120).` };
      if (sys <= 90) return { dir: 'low', level: 2, reason: `${sys}/${dia} mmHg es baja (sistólica ≤ 90).` };
      if (sys >= 130 || dia >= 80) return { dir: 'high', level: 1, reason: `${sys}/${dia} mmHg es alta (≥ 130 o ≥ 80).` };
      if (sys <= 100) return { dir: 'low', level: 1, reason: `${sys}/${dia} mmHg es algo baja (sistólica 91–100).` };
      return { level: 0, reason: `${sys}/${dia} mmHg es normal.` };
    },
  },
  glucose: {
    name: 'Glucosa en sangre', unit: 'mg/dL', source: 'manual',
    hrp: 'Food and Nutrition · Medical Conditions', range: { green: '70–180', yellow: '54–69 · 181–250', red: '< 54 · > 250' }, ref: 'ADA Standards of Care 2025; consenso Time in Range (Battelino 2019)',
    why: 'La inactividad, la dieta y el estrés del vuelo alteran cómo el cuerpo usa la glucosa. Una bajada (hipoglucemia) causa mareo y confusión, peligrosos en una salida extravehicular o al pilotar; una subida mantenida también requiere atención.',
    steps: [
      'Lávate y sécate las manos.',
      'Pincha el lateral de la yema de un dedo con la lanceta.',
      'Pon la gota en la tira del glucómetro y espera la lectura.',
      'Escribe el valor en mg/dL e indica si estás en ayunas.',
    ],
    band(v) {
      if (v < 54) return { dir: 'low', level: 2, reason: `${v} mg/dL es una hipoglucemia importante (< 54).` };
      if (v > 250) return { dir: 'high', level: 2, reason: `${v} mg/dL es muy alta (> 250).` };
      if (v < 70) return { dir: 'low', level: 1, reason: `${v} mg/dL es baja (54–69).` };
      if (v > 180) return { dir: 'high', level: 1, reason: `${v} mg/dL es alta (181–250).` };
      return { level: 0, reason: `${v} mg/dL está en rango (70–180).` };
    },
  },
  mind: {
    name: 'Ánimo y sueño', unit: '', source: 'questions',
    hrp: 'BMed · Sleep', range: { green: 'PHQ-2 ≤ 2 · sueño ≥ 7 h', yellow: 'PHQ-2 ≥ 3 · sueño 4–6,9 h · estrés ≥ 8', red: 'sueño < 4 h' }, ref: 'PHQ-2 (Kroenke 2003, corte ≥ 3); AASM/SRS (≥ 7 h); Barger 2014 (≈ 6 h en la ISS)',
    why: 'El aislamiento, el confinamiento y el sueño alterado afectan al ánimo, la atención y la convivencia. Dos preguntas breves (PHQ-2), las horas de sueño y el estrés bastan para detectar cuándo conviene hablarlo.',
    steps: [
      'Responde pensando en las últimas dos semanas.',
      'Indica cuántas horas has dormido esta noche.',
      'Marca tu nivel de estrés de hoy.',
    ],
    band({ phq2, sleep, stress }) {
      if (sleep < 4) return { level: 2, reason: `Solo ${sleep} h de sueño: el rendimiento y la seguridad se resienten.` };
      const flags = [];
      if (phq2 >= 3) flags.push(`el cribado de ánimo da ${phq2} de 6 (≥ 3: conviene hablarlo con un profesional)`);
      if (sleep < 7) flags.push(`has dormido ${sleep} h (se recomiendan 7 o más)`);
      if (stress >= 8) flags.push(`estrés de ${stress} de 10`);
      if (flags.length) return { level: 1, reason: `Conviene prestarle atención: ${flags.join(', ')}.` };
      return { level: 0, reason: 'Ánimo, sueño y estrés dentro de lo esperable.' };
    },
  },
};

// Aire de cabina según NASA-STD-3001 Vol. 2: [V2 6013] rendimiento 20–25 °C y 30–60 %;
// [V2 6012] salud 18–27 °C y 25–75 %; [V2 6006] presión total 34,5–103 kPa.
export function cabinLevel({ temperature: t, humidity: h, pressure: p }) {
  const out = [];
  if (t != null) out.push(t < 18 || t > 27 ? 2 : t < 20 || t > 25 ? 1 : 0);
  if (h != null) out.push(h < 25 || h > 75 ? 2 : h < 30 || h > 60 ? 1 : 0);
  if (p != null) out.push(p <= 345 || p > 1030 ? 2 : 0);
  return out.length ? Math.max(...out) : null;
}

export const PHQ2 = [
  'Poco interés o placer en hacer cosas',
  'Sentirte decaído, deprimido o sin esperanza',
];
export const PHQ2_ANSWERS = ['Nunca', 'Varios días', 'Más de la mitad de los días', 'Casi todos los días'];

/* ---------------------------------------------------- guía de actuación -- */
// Qué hacer ya, cuándo avisar a la tripulación y cuándo al cirujano de vuelo.

const ACTIONS = {
  hr: {
    1: { low: ['Si te notas mareado, túmbate o sujétate y repite la medida en 10 minutos.'], high: ['Descansa 10 minutos sentado o sujeto y repite la medida.', 'Bebe agua si no has bebido en las últimas horas.'] },
    2: { low: ['Túmbate o sujétate y no hagas esfuerzos.', 'Si hay mareo, desmayo o dolor en el pecho, pide ayuda inmediata a la tripulación.'], high: ['Deja cualquier tarea física o EVA ahora mismo.', 'Si tienes dolor en el pecho, falta de aire o mareo, pide ayuda inmediata a la tripulación.', 'Repite la medida en 5 minutos sin moverte.'] },
  },
  spo2: {
    1: { low: ['Respira despacio y repite la medida con la mano caliente.', 'Mira los valores de cabina: si otros tripulantes también bajan, puede ser el aire.'] },
    2: { low: ['Repite ya la medida en otro dedo.', 'Si se confirma, ponte la mascarilla de oxígeno y avisa a la tripulación.', 'Revisad el sistema de soporte vital de la cabina.'] },
  },
  bp: {
    1: { low: ['Ponte en horizontal (o sujeto) y no te levantes de golpe.', 'Bebe agua y repite la medida en 10 minutos.'], high: ['Repite la medida tras 5 minutos de reposo, sin hablar.', 'Si se mantiene alta en varios chequeos, coméntalo con el oficial médico.'] },
    2: { low: ['Túmbate con las piernas elevadas (o sujeto) y no hagas esfuerzos.', 'Avisa a la tripulación si hay mareo o visión borrosa.'], high: ['Con dolor de cabeza fuerte, visión borrosa o dolor en el pecho es una urgencia: avisa a la tripulación ya.', 'Quédate en reposo y repite la medida en 5 minutos.'] },
  },
  glucose: {
    1: { low: ['Toma 15 g de azúcar rápida (zumo, tabletas de glucosa) y repite la medida en 15 minutos.'], high: ['Bebe agua y repite la medida en 2 horas.'] },
    2: { low: ['Toma ahora 15–20 g de azúcar rápida; si hay confusión, que te ayude otro tripulante.', 'Repite la medida en 15 minutos y no hagas tareas críticas hasta que suba.'], high: ['Bebe agua, no hagas ejercicio intenso y repite la medida.', 'Avisa al oficial médico.'] },
  },
  mind: {
    1: { any: ['Habla con la psicóloga de a bordo (IA) o con alguien de confianza de la tripulación.', 'Protege tu próximo periodo de sueño y haz una pausa de respiración.'] },
    2: { any: ['Habla hoy con el oficial médico: con tan poco sueño no conviene hacer tareas críticas.', 'Pide al comandante revisar la planificación de las próximas horas.'] },
  },
};

const actionsFor = (r) => {
  const byLevel = ACTIONS[r.id]?.[r.level] || {};
  return byLevel[r.dir] || byLevel.any || Object.values(byLevel)[0] || [];
};

export function actionPlan(results, envKey) {
  const env = ENVIRONMENTS[envKey] || ENVIRONMENTS.transit;
  const worst = Math.max(0, ...results.map((r) => r.level));
  const now = results.filter((r) => r.level > 0).flatMap(actionsFor);
  const crew = worst === 2
    ? 'Avisa ahora a la tripulación y al oficial médico de a bordo.'
    : worst === 1 ? 'Coméntalo hoy con el oficial médico; si empeora o aparece algún síntoma, avisa enseguida.' : 'No hace falta avisar a nadie.';
  const surgeon = worst === 2
    ? `Envía el informe al cirujano de vuelo. ${env.ground}`
    : worst === 1 ? 'Si se repite en dos chequeos seguidos, inclúyelo en el próximo informe al cirujano de vuelo.' : 'Se incluirá en el resumen rutinario a Tierra.';
  return { worst, now, crew, surgeon, evac: worst === 2 ? env.evac : null, env };
}

export function classify(id, value) {
  const m = MEASURES[id];
  const r = m.band(value);
  return { id, name: m.name, value, level: r.level, dir: r.dir || null, reason: r.reason, hrp: m.hrp };
}

// Señales de emergencia: si alguna aparece, rojo directo, se mida lo que se mida.
export const RED_FLAGS = [
  'Dolor u opresión en el pecho',
  'Falta de aire en reposo',
  'Desmayo, confusión o dificultad para hablar',
  'Pensamientos de hacerte daño',
];
