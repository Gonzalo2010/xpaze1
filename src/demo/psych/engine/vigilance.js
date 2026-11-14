import { finite, mean, median } from './stats.js';
import { createRng } from './random.js';

// Lapse: reaction > 355 ms, the validated threshold of the brief PVT-B used on the ISS
// (Basner, Mollicone & Dinges, Acta Astronautica 2011), plus every timeout.
export const LAPSE_MS = 355;

// Numbers are reaction times in ms. Objects can explicitly represent anticipations or misses.
// A timeout is a lapse, but is not invented as a numerical reaction time.
export function scoreVigilance(trials = []) {
  const reactions = [];
  let falseStarts = 0, omissions = 0, invalid = 0;
  for (const trial of trials) {
    const ms = typeof trial === 'number' ? trial : trial?.reactionMs;
    if (trial?.falseStart === true || (finite(ms) && ms < 100)) falseStarts++;
    else if (trial?.timeout === true) omissions++;
    else if (finite(ms) && ms >= 100) reactions.push(ms);
    else invalid++;
  }
  const slowest = [...reactions].sort((a, b) => b - a).slice(0, Math.ceil(reactions.length * 0.1));
  return { meanMs: mean(reactions), medianMs: median(reactions), slowest10Ms: mean(slowest),
    lapses: reactions.filter(ms => ms > LAPSE_MS).length + omissions, falseStarts, omissions,
    validResponses: reactions.length, invalid, trials: trials.length };
}

// Delays begin after the previous trial ends. The view owns clocks and cancellation.
export function planStimuli({ seed = 1, count = 10, minIntervalMs = 2000, maxIntervalMs = 5000 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(minIntervalMs)
    || !Number.isInteger(maxIntervalMs) || minIntervalMs < 1 || maxIntervalMs < minIntervalMs) throw new RangeError('Invalid stimulus plan');
  const random = createRng(seed);
  return Array.from({ length: count }, (_, index) => ({ index,
    delayMs: minIntervalMs + Math.floor(random() * (maxIntervalMs - minIntervalMs + 1)) }));
}
