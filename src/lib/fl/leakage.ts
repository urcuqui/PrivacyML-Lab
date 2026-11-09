import { perExampleGradient, predictProba, type Sample } from '../ml/logistic';
import type { RNG } from '../rng/rng';
import type { Vec } from '../vec';

/**
 * ILUSTRACIÓN (no un ataque completo): en regresión logística, el gradiente de un único
 * ejemplo es g = (p − y)·[x, 1]. Por tanto x = g_w / g_b exactamente (si p ≠ y).
 * Con un lote de B ejemplos, g_w / g_b = Σ r_i x_i / Σ r_i: una MEDIA PONDERADA de las
 * entradas del lote (pesos r_i = p_i − y_i), que puede revelar características agregadas.
 */
export interface InversionResult {
  gradient: Vec;
  /** Estimación g_w / g_b (null si g_b ≈ 0). */
  estimate: number[] | null;
  /** Media real de las x del lote. */
  trueMean: number[];
  /** Media ponderada por residuos (lo que el cociente recupera exactamente). */
  residualWeightedMean: number[] | null;
  residuals: number[];
  /** Error euclídeo entre estimate y trueMean. */
  errorToMean: number | null;
  /** True si todos los residuos tienen el mismo signo (cociente = combinación convexa). */
  sameSignResiduals: boolean;
}

export function gradientInversion(params: Vec, batch: readonly Sample[], noise?: { rng: RNG; sd: number }): InversionResult {
  if (!batch.length) throw new RangeError('El lote no puede estar vacío');
  const d = batch[0].x.length;
  const g = new Array(d + 1).fill(0);
  const residuals: number[] = [];
  for (const s of batch) {
    residuals.push(predictProba(params, s.x) - s.y);
    perExampleGradient(params, s).forEach((v, j) => (g[j] += v / batch.length));
  }
  if (noise && noise.sd > 0) for (let j = 0; j < g.length; j++) g[j] += noise.rng.normal(0, noise.sd);
  const gb = g[d];
  const estimate = Math.abs(gb) < 1e-12 ? null : g.slice(0, d).map((v) => v / gb);
  const trueMean = Array.from({ length: d }, (_, j) => batch.reduce((s, b) => s + b.x[j], 0) / batch.length);
  const rs = residuals.reduce((a, b) => a + b, 0);
  const residualWeightedMean = Math.abs(rs) < 1e-12 ? null : Array.from({ length: d }, (_, j) => batch.reduce((s, b, i) => s + residuals[i] * b.x[j], 0) / rs);
  const errorToMean = estimate ? Math.hypot(...estimate.map((v, j) => v - trueMean[j])) : null;
  const sameSignResiduals = residuals.every((r) => r > 0) || residuals.every((r) => r < 0);
  return { gradient: g, estimate, trueMean, residualWeightedMean, residuals, errorToMean, sameSignResiduals };
}
