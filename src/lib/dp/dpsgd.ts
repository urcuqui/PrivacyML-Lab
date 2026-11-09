import { createSeededRng, deriveSeed } from '../rng/rng';
import { accuracy, bceLoss, initParams, perExampleGradient, type Sample } from '../ml/logistic';
import { clipL2, norm2, type Vec } from '../vec';
import { gaussianCompositionEpsilon, type PrivacyAccounting } from './accountant';

export interface DPSGDConfig {
  learningRate: number;
  batchSize: number;
  steps: number;
  clipNorm: number;
  noiseMultiplier: number;
  seed: number;
  delta?: number;
}

export interface PerExampleTrace {
  index: number;
  grad: Vec;
  norm: number;
  clipped: Vec;
  clippedNorm: number;
  wasClipped: boolean;
}

export interface StepTrace {
  step: number;
  paramsBefore: Vec;
  perExample: PerExampleTrace[];
  /** Suma de gradientes (recortados en DP-SGD, sin recortar en SGD). */
  gradSum: Vec;
  /** Ruido gaussiano añadido a la suma (solo DP-SGD). */
  noise: Vec | null;
  /** Gradiente final usado en la actualización = (suma [+ ruido]) / B. */
  finalGrad: Vec;
  update: Vec;
  paramsAfter: Vec;
}

export interface TrainPoint {
  step: number;
  trainLoss: number;
  testLoss: number;
  trainAcc: number;
  testAcc: number;
}

export interface TrainResult {
  mode: 'sgd' | 'dpsgd';
  history: TrainPoint[];
  params: Vec;
  traces: StepTrace[];
  gradEvals: number;
  clippedFraction: number;
  accounting: PrivacyAccounting;
}

export function validateDpsgdConfig(cfg: DPSGDConfig, n: number): string[] {
  const errs: string[] = [];
  if (!(cfg.learningRate > 0)) errs.push('La tasa de aprendizaje debe ser positiva.');
  if (!Number.isInteger(cfg.batchSize) || cfg.batchSize < 1) errs.push('El tamaño de lote debe ser un entero ≥ 1.');
  if (cfg.batchSize > n) errs.push(`El tamaño de lote (${cfg.batchSize}) no puede superar el número de ejemplos (${n}).`);
  if (!Number.isInteger(cfg.steps) || cfg.steps < 1) errs.push('El número de pasos debe ser un entero ≥ 1.');
  if (!(cfg.clipNorm > 0)) errs.push('La norma de recorte C debe ser positiva.');
  if (!(cfg.noiseMultiplier >= 0)) errs.push('El multiplicador de ruido σ no puede ser negativo.');
  return errs;
}

/**
 * Contabilidad de privacidad para DP-SGD en este laboratorio.
 * Solo se calcula en modo lote completo (B = n), donde cada paso es un mecanismo gaussiano
 * sin submuestreo. En otro caso se devuelve "No calculado".
 */
export function dpsgdAccounting(cfg: DPSGDConfig, n: number): PrivacyAccounting {
  if (cfg.noiseMultiplier <= 0) return { status: 'not-computed', reason: 'σ = 0: sin ruido no hay garantía de privacidad diferencial.' };
  if (cfg.batchSize < n) {
    return {
      status: 'not-computed',
      reason:
        'Con mini-lotes (B < n) la garantía depende de la amplificación por submuestreo, que exige muestreo de Poisson y un contador específico no implementado aquí. Usa B = n para obtener una cota formal conservadora.',
    };
  }
  return gaussianCompositionEpsilon({ noiseMultiplier: cfg.noiseMultiplier, steps: cfg.steps, delta: cfg.delta ?? 1e-5 });
}

/**
 * Entrena regresión logística con SGD estándar o con DP-SGD (Abadi et al. 2016):
 *  1) gradientes por ejemplo; 2) recorte a norma C; 3) suma; 4) ruido N(0, σ²C²I); 5) actualización.
 * Los lotes se forman barajando en cada época (práctica habitual; distinto del muestreo de Poisson).
 */
export function trainLogistic(
  mode: 'sgd' | 'dpsgd',
  train: readonly Sample[],
  test: readonly Sample[],
  cfg: DPSGDConfig,
  opts: { traceFirst?: number; evalEvery?: number } = {},
): TrainResult {
  const errs = validateDpsgdConfig(cfg, train.length);
  if (errs.length) throw new RangeError(errs.join(' '));
  const traceFirst = opts.traceFirst ?? 3;
  const evalEvery = Math.max(1, opts.evalEvery ?? Math.max(1, Math.floor(cfg.steps / 60)));
  // Misma secuencia de lotes para SGD y DP-SGD; el ruido usa un flujo independiente.
  const batchRng = createSeededRng(deriveSeed(cfg.seed, 'batches'));
  const noiseRng = createSeededRng(deriveSeed(cfg.seed, 'noise'));
  const d = train[0]?.x.length ?? 2;
  let params = initParams(d);
  const B = cfg.batchSize;
  const history: TrainPoint[] = [];
  const traces: StepTrace[] = [];
  let order: Sample[] = [];
  let orderIdx: number[] = [];
  let cursor = 0;
  let gradEvals = 0;
  let clippedCount = 0;
  const record = (step: number) =>
    history.push({ step, trainLoss: bceLoss(params, train), testLoss: bceLoss(params, test), trainAcc: accuracy(params, train), testAcc: accuracy(params, test) });
  record(0);
  for (let t = 1; t <= cfg.steps; t++) {
    if (cursor + B > order.length) {
      const idx = batchRng.shuffle(train.map((_, i) => i));
      orderIdx = idx;
      order = idx.map((i) => train[i]);
      cursor = 0;
    }
    const batch = order.slice(cursor, cursor + B);
    const batchIdx = orderIdx.slice(cursor, cursor + B);
    cursor += B;
    const perExample: PerExampleTrace[] = batch.map((s, k) => {
      const grad = perExampleGradient(params, s);
      const n = norm2(grad);
      const clipped = mode === 'dpsgd' ? clipL2(grad, cfg.clipNorm) : grad;
      const wasClipped = mode === 'dpsgd' && n > cfg.clipNorm;
      if (wasClipped) clippedCount++;
      return { index: batchIdx[k], grad, norm: n, clipped, clippedNorm: norm2(clipped), wasClipped };
    });
    gradEvals += batch.length;
    const gradSum = new Array(params.length).fill(0);
    for (const pe of perExample) for (let j = 0; j < gradSum.length; j++) gradSum[j] += pe.clipped[j];
    let noise: Vec | null = null;
    if (mode === 'dpsgd') {
      const sd = cfg.noiseMultiplier * cfg.clipNorm;
      noise = gradSum.map(() => (sd > 0 ? noiseRng.normal(0, sd) : 0));
    }
    const finalGrad = gradSum.map((g, j) => (g + (noise ? noise[j] : 0)) / B);
    const update = finalGrad.map((g) => -cfg.learningRate * g);
    const paramsBefore = params;
    params = params.map((p, j) => p + update[j]);
    if (t <= traceFirst) traces.push({ step: t, paramsBefore, perExample, gradSum, noise, finalGrad, update, paramsAfter: params });
    if (t % evalEvery === 0 || t === cfg.steps) record(t);
  }
  return {
    mode,
    history,
    params,
    traces,
    gradEvals,
    clippedFraction: mode === 'dpsgd' ? clippedCount / gradEvals : 0,
    accounting: mode === 'dpsgd' ? dpsgdAccounting(cfg, train.length) : { status: 'not-computed', reason: 'SGD estándar no ofrece garantías de privacidad diferencial.' },
  };
}
