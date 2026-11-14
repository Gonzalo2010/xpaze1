// Enlace con la Tierra: la luz tarda minutos. Lógica pura de retardos y fases.

export const LIGHT_KM_S = 299792.458;
export const DIST_RANGE = [55, 400]; // millones de km: de la oposición más cercana a la conjunción
export const REVIEW_MIN = 8;         // minutos simulados que tarda el equipo en Tierra en revisar
export const ACCEL = 60;             // 1 minuto de misión = 1 segundo de demo

export const lightMinutes = (millionKm) => (millionKm * 1e6) / LIGHT_KM_S / 60;

// Fase de un informe según el tiempo real transcurrido (ms) desde que se envió.
export function reportPhase(report, nowMs) {
  const oneWay = report.delayMin; // segundos de demo = minutos de misión
  const el = Math.max(0, (nowMs - report.sentAt) / 1000);
  const total = oneWay * 2 + REVIEW_MIN;
  if (el < oneWay) return { phase: 'outbound', progress: el / oneWay, elapsedMin: el, remainingMin: total - el, total };
  if (el < oneWay + REVIEW_MIN) return { phase: 'review', progress: 1, elapsedMin: el, remainingMin: total - el, total };
  if (el < total) return { phase: 'inbound', progress: 1 - (el - oneWay - REVIEW_MIN) / oneWay, elapsedMin: el, remainingMin: total - el, total };
  return { phase: 'answered', progress: 0, elapsedMin: total, remainingMin: 0, total };
}

export function makeReport(check, delayMin, nowMs) {
  return {
    id: check.id, astronautId: check.astronautId, day: check.day,
    status: check.analysis.status, pattern: check.analysis.pattern,
    auto: check.analysis.auto.key, delayMin, sentAt: nowMs,
  };
}
