// Fuente única de verdad clínica de la app: umbrales fijos y explicables, pasos de
// cada medición, por qué se mide, entornos y guía de actuación.
// El semáforo SIEMPRE sale de aquí (reglas fijas). La IA solo lo explica.
// docs/medical-thresholds.md (inglés) documenta estas mismas cifras con sus fuentes.

import { lang, L, onLang } from './i18n.js';

export const LEVEL = ['green', 'yellow', 'red'];

// Objeto cuyas claves devuelven el texto del idioma actual ({ es: {...}, en: {...} }).
function localized(tables, base = {}) {
  for (const k of Object.keys(tables.es)) Object.defineProperty(base, k, { enumerable: true, get: () => tables[lang()][k] });
  return base;
}

/* -------------------------------------------------------------- entornos -- */

export const ENVIRONMENTS = {
  transit: localized({
    es: {
      name: 'Nave en tránsito a Marte', short: 'Tránsito', gravity: 'microgravedad',
      delay: 'de 3 a 22 minutos por trayecto', ground: 'El cirujano de vuelo en Tierra tardará entre 6 y 45 minutos en contestar: actúa primero a bordo.',
      evac: 'No hay evacuación posible: el tratamiento se hace a bordo.',
    },
    en: {
      name: 'Spacecraft in transit to Mars', short: 'Transit', gravity: 'microgravity',
      delay: '3 to 22 minutes each way', ground: 'The flight surgeon on Earth will take 6 to 45 minutes to reply: act on board first.',
      evac: 'Evacuation is not possible: treatment happens on board.',
    },
  }),
  station: localized({
    es: {
      name: 'Estación orbital', short: 'Estación', gravity: 'microgravedad',
      delay: 'menos de 1 segundo', ground: 'Puedes hablar con el cirujano de vuelo casi en tiempo real.',
      evac: 'El regreso de emergencia a la Tierra es posible en horas.',
    },
    en: {
      name: 'Orbital station', short: 'Station', gravity: 'microgravity',
      delay: 'less than 1 second', ground: 'You can talk to the flight surgeon almost in real time.',
      evac: 'An emergency return to Earth is possible within hours.',
    },
  }),
  lunar: localized({
    es: {
      name: 'Base lunar', short: 'Base lunar', gravity: '1/6 de la gravedad terrestre',
      delay: 'unos 1,3 segundos por trayecto', ground: 'El cirujano de vuelo responde casi en tiempo real.',
      evac: 'El regreso a la Tierra lleva días: estabiliza a bordo.',
    },
    en: {
      name: 'Lunar base', short: 'Lunar base', gravity: '1/6 of Earth gravity',
      delay: 'about 1.3 seconds each way', ground: 'The flight surgeon replies almost in real time.',
      evac: 'Returning to Earth takes days: stabilise on board.',
    },
  }),
  rover: localized({
    es: {
      name: 'Rover de superficie', short: 'Rover', gravity: 'gravedad parcial',
      delay: 'depende de la base (minutos si estás en Marte)', ground: 'Avisa primero a la base; ella contacta con el cirujano de vuelo.',
      evac: 'Detén la actividad y vuelve al vehículo presurizado o al hábitat.',
    },
    en: {
      name: 'Surface rover', short: 'Rover', gravity: 'partial gravity',
      delay: 'depends on the base (minutes if you are on Mars)', ground: 'Alert the base first; it contacts the flight surgeon.',
      evac: 'Stop the activity and return to the pressurised vehicle or the habitat.',
    },
  }),
};

/* ---------------------------------------------------------- mediciones -- */
// band(value) → { level: 0|1|2, reason } con umbrales absolutos.

export const MEASURES = {
  hr: localized({
    es: {
      name: 'Pulso en reposo', unit: 'lpm',
      range: { green: '51–90', yellow: '41–50 · 91–130', red: '≤ 40 · ≥ 131' },
      why: 'El pulso en reposo es el indicador más sencillo del estado del corazón. En microgravedad el corazón trabaja con menos carga y los fluidos suben hacia la cabeza; si el pulso en reposo sube sin esfuerzo, puede deberse a fiebre, deshidratación, estrés o falta de sueño.',
      steps: [
        'Descansa dos minutos sin hablar. En microgravedad, sujeta los pies en los anclajes.',
        'Pasa tu tarjeta por el lector para que la medida vaya a tu historial.',
        'Agarra los dos asideros y apoya el pulgar derecho en la ventanita, sin apretar.',
        'Quédate quieto unos 30 segundos, hasta que la app diga «Señal buena».',
      ],
    },
    en: {
      name: 'Resting heart rate', unit: 'bpm',
      range: { green: '51–90', yellow: '41–50 · 91–130', red: '≤ 40 · ≥ 131' },
      why: 'Resting heart rate is the simplest indicator of how the heart is doing. In microgravity the heart works under less load and fluids shift towards the head; if your resting heart rate rises without effort, it may be due to fever, dehydration, stress or lack of sleep.',
      steps: [
        'Rest for two minutes without talking. In microgravity, secure your feet in the foot restraints.',
        'Tap your card on the reader so the measurement goes to your history.',
        'Hold both handles and rest your right thumb on the small window, without pressing.',
        'Stay still for about 30 seconds, until the app says “Good signal”.',
      ],
    },
  }, {
    source: 'sensor',
    hrp: 'Cardiovascular', ref: 'NEWS2 (Royal College of Physicians, 2017)',
    band(v) {
      if (v <= 40) return { dir: 'low', level: 2, reason: L(`${v} lpm es muy bajo en reposo (≤ 40).`, `${v} bpm is very low at rest (≤ 40).`) };
      if (v >= 131) return { dir: 'high', level: 2, reason: L(`${v} lpm es muy alto en reposo (≥ 131).`, `${v} bpm is very high at rest (≥ 131).`) };
      if (v <= 50) return { dir: 'low', level: 1, reason: L(`${v} lpm es bajo en reposo (41–50).`, `${v} bpm is low at rest (41–50).`) };
      if (v >= 91) return { dir: 'high', level: 1, reason: L(`${v} lpm es alto en reposo (91–130).`, `${v} bpm is high at rest (91–130).`) };
      return { level: 0, reason: L(`${v} lpm está en rango en reposo (51–90).`, `${v} bpm is in range at rest (51–90).`) };
    },
  }),
  spo2: localized({
    es: {
      name: 'Oxígeno en sangre (SpO₂)', unit: '%',
      range: { green: '≥ 96', yellow: '92–95', red: '≤ 91' },
      why: 'Indica cuánto oxígeno llevan los glóbulos rojos. Una bajada puede señalar un problema respiratorio o un fallo del aire de la cabina, y en una nave lo segundo afecta a toda la tripulación. Ojo: es una estimación de un prototipo sin calibrar.',
      steps: [
        'Se mide a la vez que el pulso, con el pulgar en la ventanita del asidero derecho.',
        'Ten la mano caliente y relajada: con frío la lectura es peor.',
        'No muevas el dedo hasta terminar.',
      ],
    },
    en: {
      name: 'Blood oxygen (SpO₂)', unit: '%',
      range: { green: '≥ 96', yellow: '92–95', red: '≤ 91' },
      why: 'Shows how much oxygen your red blood cells are carrying. A drop can point to a breathing problem or to a cabin air failure, and on a spacecraft the latter affects the whole crew. Note: this is an estimate from an uncalibrated prototype.',
      steps: [
        'It is measured together with heart rate, with your thumb on the window of the right handle.',
        'Keep your hand warm and relaxed: cold hands give worse readings.',
        'Do not move your finger until it finishes.',
      ],
    },
  }, {
    source: 'sensor',
    hrp: 'Medical Conditions · Hypoxia', ref: 'NEWS2 scale 1; WHO Pulse Oximetry Training Manual (2011)',
    band(v) {
      if (v <= 91) return { dir: 'low', level: 2, reason: L(`${v} % es bajo (≤ 91 %).`, `${v}% is low (≤ 91%).`) };
      if (v <= 95) return { dir: 'low', level: 1, reason: L(`${v} % está algo bajo (92–95 %).`, `${v}% is slightly low (92–95%).`) };
      return { level: 0, reason: L(`${v} % es normal (≥ 96 %).`, `${v}% is normal (≥ 96%).`) };
    },
  }),
  bp: localized({
    es: {
      name: 'Tensión arterial', unit: 'mmHg',
      range: { green: '101–129 / < 80', yellow: '130–179 / 80–119 · sistólica 91–100', red: '≥ 180 / ≥ 120 · sistólica ≤ 90' },
      why: 'En microgravedad la sangre se redistribuye hacia la cabeza y el pecho, y la tensión cambia. Al volver a la gravedad aparece la intolerancia ortostática: mareo o desmayo al ponerse de pie. Vigilarla ayuda a prevenir ambas cosas.',
      steps: [
        'Coloca el manguito en el brazo izquierdo, a la altura del corazón.',
        'Descansa cinco minutos sin hablar ni cruzar las piernas (en microgravedad, sujeto a los anclajes).',
        'Mide dos veces, con un minuto de separación.',
        'Escribe aquí la media de las dos medidas: la alta (sistólica) y la baja (diastólica).',
      ],
    },
    en: {
      name: 'Blood pressure', unit: 'mmHg',
      range: { green: '101–129 / < 80', yellow: '130–179 / 80–119 · systolic 91–100', red: '≥ 180 / ≥ 120 · systolic ≤ 90' },
      why: 'In microgravity blood shifts towards the head and chest, and blood pressure changes. Back in gravity, orthostatic intolerance appears: dizziness or fainting when standing up. Monitoring it helps prevent both.',
      steps: [
        'Put the cuff on your left arm, at heart level.',
        'Rest for five minutes without talking or crossing your legs (in microgravity, secured in the restraints).',
        'Measure twice, one minute apart.',
        'Enter the average of the two readings here: the top number (systolic) and the bottom number (diastolic).',
      ],
    },
  }, {
    source: 'manual',
    hrp: 'Cardiovascular (incl. orthostatic intolerance)', ref: 'ACC/AHA 2017; NEWS2 (systolic ≤ 90); NHLBI (hypotension < 90/60)',
    band({ sys, dia }) {
      if (sys >= 180 || dia >= 120) return { dir: 'high', level: 2, reason: L(`${sys}/${dia} mmHg es muy alta (≥ 180 o ≥ 120).`, `${sys}/${dia} mmHg is very high (≥ 180 or ≥ 120).`) };
      if (sys <= 90) return { dir: 'low', level: 2, reason: L(`${sys}/${dia} mmHg es baja (sistólica ≤ 90).`, `${sys}/${dia} mmHg is low (systolic ≤ 90).`) };
      if (sys >= 130 || dia >= 80) return { dir: 'high', level: 1, reason: L(`${sys}/${dia} mmHg es alta (≥ 130 o ≥ 80).`, `${sys}/${dia} mmHg is high (≥ 130 or ≥ 80).`) };
      if (sys <= 100) return { dir: 'low', level: 1, reason: L(`${sys}/${dia} mmHg es algo baja (sistólica 91–100).`, `${sys}/${dia} mmHg is slightly low (systolic 91–100).`) };
      return { level: 0, reason: L(`${sys}/${dia} mmHg es normal.`, `${sys}/${dia} mmHg is normal.`) };
    },
  }),
  glucose: localized({
    es: {
      name: 'Glucosa en sangre', unit: 'mg/dL',
      range: { green: '70–180', yellow: '54–69 · 181–250', red: '< 54 · > 250' },
      why: 'La inactividad, la dieta y el estrés del vuelo alteran cómo el cuerpo usa la glucosa. Una bajada (hipoglucemia) causa mareo y confusión, peligrosos en una salida extravehicular o al pilotar; una subida mantenida también requiere atención.',
      steps: [
        'Lávate y sécate las manos.',
        'Pincha el lateral de la yema de un dedo con la lanceta.',
        'Pon la gota en la tira del glucómetro y espera la lectura.',
        'Escribe el valor en mg/dL e indica si estás en ayunas.',
      ],
    },
    en: {
      name: 'Blood glucose', unit: 'mg/dL',
      range: { green: '70–180', yellow: '54–69 · 181–250', red: '< 54 · > 250' },
      why: 'Inactivity, diet and flight stress change how the body uses glucose. A drop (hypoglycaemia) causes dizziness and confusion, which are dangerous during a spacewalk (EVA) or while piloting; a sustained rise also needs attention.',
      steps: [
        'Wash and dry your hands.',
        'Prick the side of a fingertip with the lancet.',
        'Put the drop on the glucose meter strip and wait for the reading.',
        'Enter the value in mg/dL and say whether you are fasting.',
      ],
    },
  }, {
    source: 'manual',
    hrp: 'Food and Nutrition · Medical Conditions', ref: 'ADA Standards of Care 2025; Time in Range consensus (Battelino 2019)',
    band(v) {
      if (v < 54) return { dir: 'low', level: 2, reason: L(`${v} mg/dL es una hipoglucemia importante (< 54).`, `${v} mg/dL is significant hypoglycaemia (< 54).`) };
      if (v > 250) return { dir: 'high', level: 2, reason: L(`${v} mg/dL es muy alta (> 250).`, `${v} mg/dL is very high (> 250).`) };
      if (v < 70) return { dir: 'low', level: 1, reason: L(`${v} mg/dL es baja (54–69).`, `${v} mg/dL is low (54–69).`) };
      if (v > 180) return { dir: 'high', level: 1, reason: L(`${v} mg/dL es alta (181–250).`, `${v} mg/dL is high (181–250).`) };
      return { level: 0, reason: L(`${v} mg/dL está en rango (70–180).`, `${v} mg/dL is in range (70–180).`) };
    },
  }),
  mind: localized({
    es: {
      name: 'Ánimo y sueño', unit: '',
      range: { green: 'PHQ-2 ≤ 2 · sueño ≥ 7 h', yellow: 'PHQ-2 ≥ 3 · sueño 4–6,9 h · estrés ≥ 8', red: 'sueño < 4 h' },
      why: 'El aislamiento, el confinamiento y el sueño alterado afectan al ánimo, la atención y la convivencia. Dos preguntas breves (PHQ-2), las horas de sueño y el estrés bastan para detectar cuándo conviene hablarlo.',
      steps: [
        'Responde pensando en las últimas dos semanas.',
        'Indica cuántas horas has dormido esta noche.',
        'Marca tu nivel de estrés de hoy.',
      ],
    },
    en: {
      name: 'Mood and sleep', unit: '',
      range: { green: 'PHQ-2 ≤ 2 · sleep ≥ 7 h', yellow: 'PHQ-2 ≥ 3 · sleep 4–6.9 h · stress ≥ 8', red: 'sleep < 4 h' },
      why: 'Isolation, confinement and disrupted sleep affect mood, attention and how the crew gets along. Two short questions (PHQ-2), hours of sleep and stress level are enough to spot when it is worth talking about it.',
      steps: [
        'Answer thinking about the last two weeks.',
        'Enter how many hours you slept last night.',
        'Mark your stress level today.',
      ],
    },
  }, {
    source: 'questions',
    hrp: 'BMed · Sleep', ref: 'PHQ-2 (Kroenke 2003, cut-off ≥ 3); AASM/SRS (≥ 7 h); Barger 2014 (≈ 6 h on the ISS)',
    band({ phq2, sleep, stress }) {
      if (sleep < 4) return { level: 2, reason: L(`Solo ${sleep} h de sueño: el rendimiento y la seguridad se resienten.`, `Only ${sleep} h of sleep: performance and safety suffer.`) };
      const flags = [];
      if (phq2 >= 3) flags.push(L(`el cribado de ánimo da ${phq2} de 6 (≥ 3: conviene hablarlo con un profesional)`, `the mood screening scores ${phq2} out of 6 (≥ 3: worth talking to a professional)`));
      if (sleep < 7) flags.push(L(`has dormido ${sleep} h (se recomiendan 7 o más)`, `you slept ${sleep} h (7 or more is recommended)`));
      if (stress >= 8) flags.push(L(`estrés de ${stress} de 10`, `stress at ${stress} out of 10`));
      if (flags.length) return { level: 1, reason: L(`Conviene prestarle atención: ${flags.join(', ')}.`, `Worth paying attention to: ${flags.join(', ')}.`) };
      return { level: 0, reason: L('Ánimo, sueño y estrés dentro de lo esperable.', 'Mood, sleep and stress are within the expected range.') };
    },
  }),
  temp: localized({
    es: {
      name: 'Temperatura corporal', unit: '°C',
      range: { green: '36,1–38,0', yellow: '35,1–36,0 · ≥ 38,1', red: '≤ 35,0' },
      why: 'La fiebre es la primera señal de una infección, y en una nave cerrada una infección puede pasar a toda la tripulación. El sistema inmunitario se debilita en vuelos largos. La estación la mide sin contacto, con un sensor infrarrojo apuntando a la frente.',
      steps: ['Se mide sola mientras agarras los asideros: mira de frente a la pantalla.'],
    },
    en: {
      name: 'Body temperature', unit: '°C',
      range: { green: '36.1–38.0', yellow: '35.1–36.0 · ≥ 38.1', red: '≤ 35.0' },
      why: 'Fever is the first sign of an infection, and in a closed spacecraft an infection can spread to the whole crew. The immune system weakens on long flights. The station measures it without contact, with an infrared sensor aimed at your forehead.',
      steps: ['It is measured automatically while you hold the handles: face the screen.'],
    },
  }, {
    source: 'sensor', hrp: 'Immune · Infection', ref: 'NEWS2 (Royal College of Physicians, 2017)',
    band(v) {
      const f = (x) => x.toLocaleString(lang() === 'es' ? 'es-ES' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      if (v <= 35.0) return { dir: 'low', level: 2, reason: L(`${f(v)} °C es hipotermia (≤ 35,0 °C).`, `${f(v)} °C is hypothermia (≤ 35.0 °C).`) };
      if (v <= 36.0) return { dir: 'low', level: 1, reason: L(`${f(v)} °C está algo baja (35,1–36,0 °C).`, `${f(v)} °C is slightly low (35.1–36.0 °C).`) };
      if (v >= 39.1) return { dir: 'high', level: 1, reason: L(`${f(v)} °C es fiebre alta (≥ 39,1 °C).`, `${f(v)} °C is a high fever (≥ 39.1 °C).`) };
      if (v >= 38.1) return { dir: 'high', level: 1, reason: L(`${f(v)} °C es fiebre (38,1–39,0 °C).`, `${f(v)} °C is a fever (38.1–39.0 °C).`) };
      return { level: 0, reason: L(`${f(v)} °C es normal (36,1–38,0 °C).`, `${f(v)} °C is normal (36.1–38.0 °C).`) };
    },
  }),
  resp: localized({
    es: {
      name: 'Respiración', unit: 'rpm',
      range: { green: '12–20', yellow: '9–11 · 21–24', red: '≤ 8 · ≥ 25' },
      why: 'Respirar más rápido de lo normal en reposo es de las primeras señales de que algo va mal: fiebre, falta de oxígeno, CO₂ alto en la cabina o ansiedad. La estación la calcula a partir de cómo cambian el ECG y la onda de pulso con cada respiración.',
      steps: ['Respira con normalidad mientras agarras los asideros; no la controles.'],
    },
    en: {
      name: 'Breathing rate', unit: 'breaths/min',
      range: { green: '12–20', yellow: '9–11 · 21–24', red: '≤ 8 · ≥ 25' },
      why: 'Breathing faster than normal at rest is one of the earliest signs that something is wrong: fever, low oxygen, high cabin CO₂ or anxiety. The station derives it from how the ECG and the pulse wave change with each breath.',
      steps: ['Breathe normally while you hold the handles; do not control it.'],
    },
  }, {
    source: 'sensor', hrp: 'Medical Conditions', ref: 'NEWS2 (Royal College of Physicians, 2017)',
    band(v) {
      if (v <= 8) return { dir: 'low', level: 2, reason: L(`${v} respiraciones por minuto es muy poco (≤ 8).`, `${v} breaths per minute is very low (≤ 8).`) };
      if (v >= 25) return { dir: 'high', level: 2, reason: L(`${v} respiraciones por minuto es muy rápido (≥ 25).`, `${v} breaths per minute is very fast (≥ 25).`) };
      if (v <= 11) return { dir: 'low', level: 1, reason: L(`${v} respiraciones por minuto es algo lento (9–11).`, `${v} breaths per minute is slightly slow (9–11).`) };
      if (v >= 21) return { dir: 'high', level: 1, reason: L(`${v} respiraciones por minuto es rápido en reposo (21–24).`, `${v} breaths per minute is fast at rest (21–24).`) };
      return { level: 0, reason: L(`${v} respiraciones por minuto es normal (12–20).`, `${v} breaths per minute is normal (12–20).`) };
    },
  }),
  rhythm: localized({
    es: {
      name: 'Ritmo del corazón (ECG)', unit: '',
      range: { green: 'sinusal', yellow: 'extrasístoles frecuentes · irregular', red: '—' },
      why: 'El ECG de los asideros muestra si el corazón late con un ritmo ordenado. En vuelos largos se han descrito arritmias, y una fibrilación auricular sin detectar aumenta el riesgo de ictus. XPaze no diagnostica: si el ritmo es irregular, lo marca para que lo revise el oficial médico con un ECG completo.',
      steps: ['Agarra los dos asideros con las dos manos y no hables durante la medida.'],
    },
    en: {
      name: 'Heart rhythm (ECG)', unit: '',
      range: { green: 'sinus', yellow: 'frequent ectopics · irregular', red: '—' },
      why: 'The ECG from the handles shows whether the heart beats in an orderly rhythm. Arrhythmias have been reported on long flights, and undetected atrial fibrillation raises the risk of stroke. XPaze does not diagnose: if the rhythm is irregular, it flags it for the medical officer to check with a full ECG.',
      steps: ['Hold both handles with both hands and do not talk during the measurement.'],
    },
  }, {
    source: 'sensor', hrp: 'Cardiovascular', ref: 'ESC 2020 AF guidelines (single-lead ECG screening must be confirmed by a physician)',
    band(v) {
      if (v === 'irregular') return { level: 1, reason: L('Ritmo irregular sin patrón, compatible con fibrilación auricular. Necesita un ECG de 12 derivaciones.', 'Irregular rhythm with no pattern, compatible with atrial fibrillation. It needs a 12-lead ECG.') };
      if (v === 'ectopics') return { level: 1, reason: L('Latidos adelantados (extrasístoles) repetidos. Suelen ser benignos, pero hay que vigilarlos.', 'Repeated early beats (ectopics). Usually benign, but they need watching.') };
      return { level: 0, reason: L('Ritmo sinusal: el corazón late de forma ordenada.', 'Sinus rhythm: the heart beats in an orderly way.') };
    },
  }),
  qtc: localized({
    es: {
      name: 'Intervalo QTc (ECG)', unit: 'ms',
      range: { green: '< 460', yellow: '460–499', red: '≥ 500' },
      why: 'El QTc mide cuánto tarda el corazón en «recargarse» entre latidos. Algunos medicamentos del botiquín (contra las náuseas o para dormir) lo alargan, y un QTc muy largo puede causar arritmias graves.',
      steps: ['Se calcula del mismo ECG de los asideros.'],
    },
    en: {
      name: 'QTc interval (ECG)', unit: 'ms',
      range: { green: '< 460', yellow: '460–499', red: '≥ 500' },
      why: 'QTc measures how long the heart takes to “recharge” between beats. Some medicines in the medical kit (for nausea or sleep) lengthen it, and a very long QTc can cause serious arrhythmias.',
      steps: ['It is calculated from the same handle ECG.'],
    },
  }, {
    source: 'sensor', hrp: 'Cardiovascular', ref: 'AHA/ACCF/HRS 2009 ECG standardization; Drew et al., Circulation 2010 (QTc ≥ 500 ms)',
    band(v) {
      if (v >= 500) return { dir: 'high', level: 2, reason: L(`QTc de ${v} ms: muy largo (≥ 500 ms), riesgo de arritmia.`, `QTc of ${v} ms: very long (≥ 500 ms), risk of arrhythmia.`) };
      if (v >= 460) return { dir: 'high', level: 1, reason: L(`QTc de ${v} ms: alargado (460–499 ms).`, `QTc of ${v} ms: prolonged (460–499 ms).`) };
      return { level: 0, reason: L(`QTc de ${v} ms: normal (< 460 ms).`, `QTc of ${v} ms: normal (< 460 ms).`) };
    },
  }),
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

// CO₂ de cabina (presión parcial, mmHg) según NASA-STD-3001 Vol. 2 [V2 6004]: ≤ 3 mmHg de media en 1 h.
// Por encima de ~2,5 mmHg se han descrito dolor de cabeza y peor rendimiento a bordo (OCHMO-TB-004).
export function co2Level(mmHg) {
  if (mmHg == null) return null;
  return mmHg > 3 ? 2 : mmHg > 2.5 ? 1 : 0;
}

const PHQ2_T = {
  es: ['Poco interés o placer en hacer cosas', 'Sentirte decaído, deprimido o sin esperanza'],
  en: ['Little interest or pleasure in doing things', 'Feeling down, depressed or hopeless'],
};
const PHQ2_ANSWERS_T = {
  es: ['Nunca', 'Varios días', 'Más de la mitad de los días', 'Casi todos los días'],
  en: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'],
};
// Señales de emergencia: si alguna aparece, rojo directo, se mida lo que se mida.
// El índice SELF_HARM marca la que exige no dejar sola a la persona.
const RED_FLAGS_T = {
  es: ['Dolor u opresión en el pecho', 'Falta de aire en reposo', 'Desmayo, confusión o dificultad para hablar', 'Pensamientos de hacerte daño'],
  en: ['Chest pain or tightness', 'Shortness of breath at rest', 'Fainting, confusion or difficulty speaking', 'Thoughts of harming yourself'],
};
export const SELF_HARM = 3;
export const isSelfHarm = (flag) => flag === RED_FLAGS_T.es[SELF_HARM] || flag === RED_FLAGS_T.en[SELF_HARM];

// Enlaces vivos: cambian con el idioma.
export let PHQ2 = PHQ2_T[lang()];
export let PHQ2_ANSWERS = PHQ2_ANSWERS_T[lang()];
export let RED_FLAGS = RED_FLAGS_T[lang()];
onLang((l) => { PHQ2 = PHQ2_T[l]; PHQ2_ANSWERS = PHQ2_ANSWERS_T[l]; RED_FLAGS = RED_FLAGS_T[l]; });

/* ---------------------------------------------------- guía de actuación -- */
// Qué hacer ya, cuándo avisar a la tripulación y cuándo al cirujano de vuelo.

const ACTIONS_ES = {
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

const ACTIONS_EN = {
  hr: {
    1: { low: ['If you feel dizzy, lie down or hold on, and measure again in 10 minutes.'], high: ['Rest for 10 minutes seated or secured, then measure again.', 'Drink water if you have not had any in the last few hours.'] },
    2: { low: ['Lie down or hold on and avoid any exertion.', 'If there is dizziness, fainting or chest pain, ask the crew for help immediately.'], high: ['Stop any physical task or EVA right now.', 'If you have chest pain, shortness of breath or dizziness, ask the crew for help immediately.', 'Measure again in 5 minutes without moving.'] },
  },
  spo2: {
    1: { low: ['Breathe slowly and measure again with a warm hand.', 'Check the cabin readings: if other crew members are dropping too, it may be the air.'] },
    2: { low: ['Measure again now on another finger.', 'If it is confirmed, put on the oxygen mask and alert the crew.', 'Check the cabin life-support system.'] },
  },
  bp: {
    1: { low: ['Lie flat (or stay secured) and do not get up suddenly.', 'Drink water and measure again in 10 minutes.'], high: ['Measure again after 5 minutes of rest, without talking.', 'If it stays high across several check-ups, mention it to the medical officer.'] },
    2: { low: ['Lie down with your legs raised (or stay secured) and avoid any exertion.', 'Alert the crew if there is dizziness or blurred vision.'], high: ['With a severe headache, blurred vision or chest pain it is an emergency: alert the crew now.', 'Stay at rest and measure again in 5 minutes.'] },
  },
  glucose: {
    1: { low: ['Take 15 g of fast-acting sugar (juice, glucose tablets) and measure again in 15 minutes.'], high: ['Drink water and measure again in 2 hours.'] },
    2: { low: ['Take 15–20 g of fast-acting sugar now; if you feel confused, have another crew member help you.', 'Measure again in 15 minutes and avoid critical tasks until it rises.'], high: ['Drink water, avoid intense exercise and measure again.', 'Tell the medical officer.'] },
  },
  mind: {
    1: { any: ['Talk to the on-board psychologist (AI) or to someone you trust in the crew.', 'Protect your next sleep period and take a breathing break.'] },
    2: { any: ['Talk to the medical officer today: with so little sleep it is best to avoid critical tasks.', 'Ask the commander to review the plan for the next few hours.'] },
  },
};

// Sensores ampliados de la estación v2 (ECG, temperatura sin contacto, respiración)
Object.assign(ACTIONS_ES, {
  hrv: { 1: { any: ['Prioriza dormir esta noche y baja la carga de ejercicio intenso hoy.', 'Haz 5 minutos de respiración lenta (6 respiraciones por minuto).', 'Si sigue baja varios días, habla con el oficial médico y con Paze.'] } },
  temp: {
    1: { high: ['Bebe agua, descansa y repite la medida en 1 hora.', 'Usa mascarilla y limita el contacto cercano: en una nave una infección pasa a toda la tripulación.', 'Avisa al oficial médico si sube de 39 °C o aparecen otros síntomas.'], low: ['Abrígate y repite la medida en 15 minutos.', 'Revisa la temperatura de la cabina.'] },
    2: { low: ['Avisa a la tripulación: hay que recalentarte poco a poco.', 'Revisa el soporte vital y la temperatura de la cabina.'] },
  },
  resp: {
    1: { high: ['Siéntate o sujétate y respira despacio por la nariz un par de minutos; repite la medida.', 'Mira el CO₂ de la cabina: si está alto, avisa a la tripulación.'], low: ['Repite la medida despierto y sin hablar.'] },
    2: { any: ['Avisa ahora al oficial médico.', 'Comprueba el oxígeno y el CO₂ de la cabina.'] },
  },
  rhythm: {
    1: { any: ['Repite el ECG en 10 minutos, quieto y sin hablar.', 'Si notas palpitaciones, mareo, falta de aire o dolor en el pecho, avisa a la tripulación ya.', 'El oficial médico debe confirmarlo con un ECG de 12 derivaciones.', 'Evita cafeína y esfuerzo intenso hasta que lo revisen.'] },
  },
  qtc: {
    1: { any: ['Revisa con el oficial médico la medicación que has tomado (antieméticos, somníferos…).', 'Repite el ECG mañana.'] },
    2: { any: ['No tomes más medicación que alargue el QT y avisa hoy al oficial médico.', 'Si te mareas o te desmayas, es una urgencia.'] },
  },
});
Object.assign(ACTIONS_EN, {
  hrv: { 1: { any: ['Prioritise sleep tonight and reduce hard exercise today.', 'Do 5 minutes of slow breathing (6 breaths per minute).', 'If it stays low for several days, talk to the medical officer and to Paze.'] } },
  temp: {
    1: { high: ['Drink water, rest and measure again in 1 hour.', 'Wear a mask and limit close contact: on a spacecraft an infection spreads to the whole crew.', 'Tell the medical officer if it goes above 39 °C or other symptoms appear.'], low: ['Put on warm clothes and measure again in 15 minutes.', 'Check the cabin temperature.'] },
    2: { low: ['Alert the crew: you need to be rewarmed gradually.', 'Check life support and the cabin temperature.'] },
  },
  resp: {
    1: { high: ['Sit or hold on and breathe slowly through your nose for a couple of minutes; measure again.', 'Check cabin CO₂: if it is high, alert the crew.'], low: ['Measure again while awake and not talking.'] },
    2: { any: ['Alert the medical officer now.', 'Check cabin oxygen and CO₂.'] },
  },
  rhythm: {
    1: { any: ['Repeat the ECG in 10 minutes, still and without talking.', 'If you feel palpitations, dizziness, shortness of breath or chest pain, alert the crew now.', 'The medical officer must confirm it with a 12-lead ECG.', 'Avoid caffeine and hard exercise until it is checked.'] },
  },
  qtc: {
    1: { any: ['Review the medication you have taken (anti-nausea, sleep aids…) with the medical officer.', 'Repeat the ECG tomorrow.'] },
    2: { any: ['Do not take any more QT-prolonging medication and tell the medical officer today.', 'If you feel faint or pass out, it is an emergency.'] },
  },
});

const actionsFor = (r) => {
  const byLevel = (lang() === 'es' ? ACTIONS_ES : ACTIONS_EN)[r.id]?.[r.level] || {};
  return byLevel[r.dir] || byLevel.any || Object.values(byLevel)[0] || [];
};

export function actionPlan(results, envKey) {
  const env = ENVIRONMENTS[envKey] || ENVIRONMENTS.transit;
  const worst = Math.max(0, ...results.map((r) => r.level));
  const now = results.filter((r) => r.level > 0).flatMap(actionsFor);
  const crew = worst === 2
    ? L('Avisa ahora a la tripulación y al oficial médico de a bordo.', 'Alert the crew and the on-board medical officer now.')
    : worst === 1 ? L('Coméntalo hoy con el oficial médico; si empeora o aparece algún síntoma, avisa enseguida.', 'Mention it to the medical officer today; if it gets worse or any symptom appears, report it straight away.')
      : L('No hace falta avisar a nadie.', 'No need to alert anyone.');
  const surgeon = worst === 2
    ? L(`Envía el informe al cirujano de vuelo. ${env.ground}`, `Send the report to the flight surgeon. ${env.ground}`)
    : worst === 1 ? L('Si se repite en dos chequeos seguidos, inclúyelo en el próximo informe al cirujano de vuelo.', 'If it happens in two check-ups in a row, include it in the next report to the flight surgeon.')
      : L('Se incluirá en el resumen rutinario a Tierra.', 'It will be included in the routine summary to Earth.');
  return { worst, now, crew, surgeon, evac: worst === 2 ? env.evac : null, env };
}

export function classify(id, value) {
  const m = MEASURES[id];
  const r = m.band(value);
  return { id, name: m.name, value, level: r.level, dir: r.dir || null, reason: r.reason, hrp: m.hrp };
}
