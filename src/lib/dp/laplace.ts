import type { RNG } from '../rng/rng';
import { mean, std, quantile } from '../stats';

export function assertEpsilon(epsilon: number): void {
  if (!(epsilon > 0) || !Number.isFinite(epsilon)) throw new RangeError('ε debe ser un número positivo y finito');
}
export function assertSensitivity(sensitivity: number): void {
  if (!(sensitivity > 0) || !Number.isFinite(sensitivity)) throw new RangeError('La sensibilidad debe ser positiva y finita');
}

/** Escala del mecanismo de Laplace: b = Δf / ε. */
export function laplaceScale(sensitivity: number, epsilon: number): number {
  assertEpsilon(epsilon);
  assertSensitivity(sensitivity);
  return sensitivity / epsilon;
}

export function laplacePdf(x: number, mu: number, b: number): number {
  return Math.exp(-Math.abs(x - mu) / b) / (2 * b);
}
export function laplaceCdf(x: number, mu: number, b: number): number {
  return x < mu ? 0.5 * Math.exp((x - mu) / b) : 1 - 0.5 * Math.exp(-(x - mu) / b);
}

export interface LaplaceRelease {
  trueValue: number;
  released: number;
  noise: number;
  scale: number;
  absError: number;
  epsilon: number;
  sensitivity: number;
}

/** Mecanismo de Laplace: M(D) = f(D) + Lap(Δf/ε). Satisface ε-DP pura si Δf es la sensibilidad L1 real. */
export function laplaceMechanism(trueValue: number, sensitivity: number, epsilon: number, rng: RNG): LaplaceRelease {
  const scale = laplaceScale(sensitivity, epsilon);
  const noise = rng.laplace(scale);
  return { trueValue, released: trueValue + noise, noise, scale, absError: Math.abs(noise), epsilon, sensitivity };
}

export interface LaplaceSimulation {
  releases: number[];
  noises: number[];
  absErrors: number[];
  scale: number;
  meanAbsError: number;
  stdAbsError: number;
  meanRelease: number;
  stdRelease: number;
  p05: number;
  p95: number;
  /** Valor teórico E|ruido| = b. */
  theoreticalMAE: number;
  /** Desviación estándar teórica = √2 · b. */
  theoreticalStd: number;
}

export function simulateLaplace(trueValue: number, sensitivity: number, epsilon: number, reps: number, rng: RNG): LaplaceSimulation {
  if (!Number.isInteger(reps) || reps < 1) throw new RangeError('El número de repeticiones debe ser un entero ≥ 1');
  const scale = laplaceScale(sensitivity, epsilon);
  const noises = new Array<number>(reps);
  for (let i = 0; i < reps; i++) noises[i] = rng.laplace(scale);
  const releases = noises.map((z) => trueValue + z);
  const absErrors = noises.map(Math.abs);
  return {
    releases,
    noises,
    absErrors,
    scale,
    meanAbsError: mean(absErrors),
    stdAbsError: std(absErrors),
    meanRelease: mean(releases),
    stdRelease: std(releases),
    p05: quantile(releases, 0.05),
    p95: quantile(releases, 0.95),
    theoreticalMAE: scale,
    theoreticalStd: Math.SQRT2 * scale,
  };
}

/**
 * Pérdida de privacidad puntual entre D y D' (vecinos) para la salida x:
 * L(x) = ln( p_D(x) / p_D'(x) ). Para Laplace siempre |L(x)| ≤ |f(D)-f(D')|/b ≤ ε.
 */
export function laplacePrivacyLoss(x: number, muD: number, muDPrime: number, b: number): number {
  return (Math.abs(x - muDPrime) - Math.abs(x - muD)) / b;
}
