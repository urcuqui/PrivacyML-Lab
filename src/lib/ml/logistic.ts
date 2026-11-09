import type { RNG } from '../rng/rng';
import type { Vec } from '../vec';

/** Una muestra con d características y etiqueta binaria. */
export interface Sample {
  x: number[];
  y: 0 | 1;
}

/**
 * Regresión logística. Parámetros θ = [w_1, …, w_d, b] (el sesgo va al final).
 */
export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function initParams(d: number): Vec {
  return new Array(d + 1).fill(0);
}

export function logit(params: Vec, x: readonly number[]): number {
  const d = x.length;
  let z = params[d];
  for (let i = 0; i < d; i++) z += params[i] * x[i];
  return z;
}

export function predictProba(params: Vec, x: readonly number[]): number {
  return sigmoid(logit(params, x));
}

const EPS = 1e-12;
/** Entropía cruzada binaria media. */
export function bceLoss(params: Vec, data: readonly Sample[]): number {
  if (!data.length) return NaN;
  let s = 0;
  for (const { x, y } of data) {
    const p = Math.min(1 - EPS, Math.max(EPS, predictProba(params, x)));
    s += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return s / data.length;
}

export function accuracy(params: Vec, data: readonly Sample[]): number {
  if (!data.length) return NaN;
  let c = 0;
  for (const { x, y } of data) if ((predictProba(params, x) >= 0.5 ? 1 : 0) === y) c++;
  return c / data.length;
}

/** Gradiente de la pérdida de UN ejemplo: ∇θ ℓ = (σ(θᵀx̃) − y) · x̃, con x̃ = [x, 1]. */
export function perExampleGradient(params: Vec, s: Sample): Vec {
  const r = predictProba(params, s.x) - s.y;
  const g = s.x.map((xi) => r * xi);
  g.push(r);
  return g;
}

export function meanGradient(params: Vec, batch: readonly Sample[]): Vec {
  const g = new Array(params.length).fill(0);
  for (const s of batch) {
    const gi = perExampleGradient(params, s);
    for (let j = 0; j < g.length; j++) g[j] += gi[j];
  }
  return g.map((v) => v / batch.length);
}

export interface SgdResult {
  params: Vec;
  epochLosses: number[];
  gradEvals: number;
}

/** SGD por mini-lotes (no privado) durante `epochs` épocas. */
export function sgdTrain(start: Vec, data: readonly Sample[], epochs: number, lr: number, batchSize: number, rng: RNG): SgdResult {
  let params = start.slice();
  const epochLosses: number[] = [];
  let gradEvals = 0;
  const bs = Math.max(1, Math.min(batchSize, data.length));
  for (let e = 0; e < epochs; e++) {
    const order = rng.shuffle(data);
    for (let i = 0; i < order.length; i += bs) {
      const batch = order.slice(i, i + bs);
      const g = meanGradient(params, batch);
      gradEvals += batch.length;
      params = params.map((p, j) => p - lr * g[j]);
    }
    epochLosses.push(bceLoss(params, data));
  }
  return { params, epochLosses, gradEvals };
}

export interface BlobOptions {
  /** Probabilidad de y = 1. */
  pPositive?: number;
  /** Semidiferencia de medias: μ₁ = m + centro, μ₀ = m − centro. */
  center?: [number, number];
  /** Escala global de la dispersión. */
  sd?: number;
  /** Desplazamiento de características aplicado a ambas clases (covariate shift). */
  shift?: [number, number];
}

/**
 * Geometría del problema sintético. Las clases comparten una covarianza ANISÓTROPA y
 * correlacionada (desviaciones 1,6·sd y 0,55·sd en ejes rotados) y su punto medio m no está en
 * el origen. Así la dirección de la diferencia de medias NO es la frontera óptima de Bayes
 * (que es Σ⁻¹(μ₁ − μ₀)) y el sesgo debe aprenderse: el modelo necesita varias iteraciones para
 * converger, lo que hace visibles los efectos del ruido, la heterogeneidad y la comunicación.
 */
export const BLOB_GEOMETRY = {
  midpoint: [0.8, -0.6] as [number, number],
  axisSd: [1.6, 0.55] as [number, number],
  rotation: 0.45, // radianes (~26°); la diferencia de medias está a 45°
};

/** Dos nubes gaussianas en 2D (sintéticas) con covarianza común anisótropa. */
export function generateBlobs(n: number, rng: RNG, opts: BlobOptions = {}): Sample[] {
  const { pPositive = 0.5, center = [1, 1], sd = 1, shift = [0, 0] } = opts;
  const { midpoint, axisSd, rotation } = BLOB_GEOMETRY;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const y: 0 | 1 = rng.next() < pPositive ? 1 : 0;
    const sign = y === 1 ? 1 : -1;
    const z1 = rng.normal(0, axisSd[0] * sd);
    const z2 = rng.normal(0, axisSd[1] * sd);
    out.push({
      x: [midpoint[0] + shift[0] + sign * center[0] + c * z1 - s * z2, midpoint[1] + shift[1] + sign * center[1] + s * z1 + c * z2],
      y,
    });
  }
  return out;
}

export function splitTrainTest(data: readonly Sample[], testFraction: number, rng: RNG): { train: Sample[]; test: Sample[] } {
  const s = rng.shuffle(data);
  const nTest = Math.round(s.length * testFraction);
  return { test: s.slice(0, nTest), train: s.slice(nTest) };
}
