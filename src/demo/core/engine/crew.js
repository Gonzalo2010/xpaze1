// Tripulación ficticia y definición de métricas. Cada persona tiene SU normal.

export const CREW = [
  {
    id: 'vega', name: 'Vega Mar', roleKey: 'role.commander', initials: 'VM', uid: '04 A3 7F 1C', hue: 212,
    baseline: { hr: 58, hrv: 62, temp: 36.5, spo2: 98, sleepH: 7.2, sleepQuality: 82, activityMin: 120 },
  },
  {
    id: 'iker', name: 'Íker Solano', roleKey: 'role.engineer', initials: 'ÍS', uid: '04 5B E2 90', hue: 28,
    baseline: { hr: 66, hrv: 45, temp: 36.7, spo2: 97.5, sleepH: 6.6, sleepQuality: 74, activityMin: 105 },
  },
  {
    id: 'noa', name: 'Noa Lindqvist', roleKey: 'role.medical', initials: 'NL', uid: '04 C8 19 D4', hue: 268,
    baseline: { hr: 72, hrv: 38, temp: 36.9, spo2: 98, sleepH: 7.6, sleepQuality: 80, activityMin: 95 },
  },
  {
    id: 'amara', name: 'Amara Okoye', roleKey: 'role.scientist', initials: 'AO', uid: '04 E1 66 3A', hue: 152,
    baseline: { hr: 49, hrv: 85, temp: 36.2, spo2: 96.5, sleepH: 6.9, sleepQuality: 78, activityMin: 140 },
  },
];

export const crewById = (id) => CREW.find((a) => a.id === id) || null;

// adverse: dirección que preocupa (+1 subir, −1 bajar).
// pop: rango poblacional orientativo en reposo (adulto sano), solo para comparar.
// sd / sdRel: variación diaria simulada. floor: escala mínima para el z robusto.
export const METRICS = {
  hr: { unitKey: 'unit.bpm', digits: 0, pop: [60, 100], adverse: 1, sd: 2.0, floor: 1.5 },
  hrv: { unitKey: 'unit.ms', digits: 0, pop: [20, 90], adverse: -1, sdRel: 0.08, floor: 3 },
  temp: { unitKey: 'unit.c', digits: 1, pop: [36.1, 37.2], adverse: 1, sd: 0.12, floor: 0.1 },
  spo2: { unitKey: 'unit.pct', digits: 0, pop: [95, 100], adverse: -1, sd: 0.45, floor: 0.5 },
  sleepH: { unitKey: 'unit.h', digits: 1, pop: [7, 9], adverse: -1, sd: 0.5, floor: 0.4 },
};

export const VITALS = ['hr', 'hrv', 'temp', 'spo2'];
export const FEATURES = ['hr', 'hrv', 'temp', 'spo2', 'sleepH'];
