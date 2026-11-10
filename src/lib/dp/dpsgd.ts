import { createSeededRng, deriveSeed } from '../rng/rng';
import { accuracy, bceLoss, initParams, perExampleGradient, type Sample } from '../ml/logistic';
import { clipL2, norm2, type Vec } from '../vec';
import { gaussianCompositionEpsilon, type PrivacyAccounting } from './accountant';
import { clippedSumSensitivityMultiple, type Adjacency } from '../privacy/model';

export interface DPSGDConfig {
  learningRate: number;
  batchSize: number;
  steps: number;
  clipNorm: number;
  noiseMultiplier: number;
  seed: number;
  delta?: number;
  /** Vecindad a nivel de registro usada para la contabilidad (por defecto añadir/eliminar). */
  adjacency?: Adjacency;
}

/**
 * Calendario de lotes: en cada época se baraja una permutación de los índices (independiente
 * de los datos: solo depende de n, B y la semilla) y se toman ⌊n/B⌋ lotes consecutivos de
 * tamaño B; el resto se descarta. Por tanto cada registro aparece COMO MUCHO una vez por época.
 */
export function createBatchScheduler(n: number, B: number, seed: number) {
  const rng = createSeededRng(deriveSeed(seed, 'batches'));
  let order: number[] = [];
  let pos = 0;
  return {
    next(): number[] {
      if (pos + B > order.length) {
        order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
        pos = 0;
      }
      const batch = order.slice(pos, pos + B);
      pos += B;
      return batch;
    },
  };
}

/** Cota superior del número de pasos en que participa un registro: ⌈T / ⌊n/B⌋⌉ (épocas iniciadas). */
export function maxParticipationsPerRecord(n: number, B: number, steps: number): number {
  const perEpoch = Math.floor(n / B);
  if (perEpoch < 1) throw new RangeError('B no puede superar n');
  return Math.ceil(steps / perEpoch);
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
 * Contabilidad de privacidad para DP-SGD (privacidad a nivel de REGISTRO).
 *
 * - σ = 0 ⇒ sin garantía.
 * - Añadir/eliminar, lote completo (B = n): cada paso es un mecanismo gaussiano sobre la suma de
 *   TODOS los gradientes recortados con Δ₂ = C, dividida por la constante pública B ⇒ T composiciones.
 * - Añadir/eliminar, mini-lotes: el calendario de lotes depende de n (que cambia entre vecinos) y la
 *   amplificación por submuestreo exigiría muestreo de Poisson y un contador específico ⇒ "No calculado".
 * - Reemplazar (n público): el calendario no depende de los datos; en cada paso el registro reemplazado
 *   está en el lote (Δ₂ = 2C) o no (divergencia 0). Por la cuasi-convexidad conjunta de la divergencia
 *   de Rényi basta acotar el peor calendario: cada registro participa como mucho en ⌈T/⌊n/B⌋⌉ pasos
 *   (una vez por época) ⇒ ese número de composiciones con Δ₂ = 2C. Cota sin amplificación.
 */
export function dpsgdAccounting(cfg: DPSGDConfig, n: number): PrivacyAccounting {
  const adjacency = cfg.adjacency ?? 'add-remove';
  if (!(cfg.noiseMultiplier > 0)) return { status: 'not-computed', reason: 'σ = 0: sin ruido no hay garantía de privacidad diferencial (el recorte por sí solo no es DP).' };
  const fullBatch = cfg.batchSize >= n;
  const delta = cfg.delta ?? 1e-5;
  const k = clippedSumSensitivityMultiple(adjacency);
  if (adjacency === 'add-remove' && !fullBatch) {
    return {
      status: 'not-computed',
      reason:
        'Con vecindad añadir/eliminar y mini-lotes (B < n), el calendario de lotes depende de n (que cambia entre conjuntos vecinos) y una garantía ajustada requiere amplificación por submuestreo con muestreo de Poisson y un contador específico, no implementados aquí. Usa B = n (lote completo) o la vecindad por reemplazo (n público) para obtener una cota conservadora.',
    };
  }
  const compositions = fullBatch ? cfg.steps : maxParticipationsPerRecord(n, cfg.batchSize, cfg.steps);
  const r = gaussianCompositionEpsilon({ noiseMultiplier: cfg.noiseMultiplier, steps: compositions, delta, sensitivityMultiple: k });
  const scheduleNote = fullBatch
    ? `Lote completo: cada uno de los T = ${cfg.steps} pasos usa todos los registros y divide por la constante pública B.`
    : `Mini-lotes con n = ${n} público: ⌊n/B⌋ = ${Math.floor(n / cfg.batchSize)} lotes por época; cada registro participa en ≤ ⌈T/⌊n/B⌋⌉ = ${compositions} pasos y en el resto su contribución es nula.`;
  return {
    ...r,
    assumptions: [
      'Unidad de privacidad: un REGISTRO (ejemplo de entrenamiento).',
      adjacency === 'replace' ? 'Vecindad por reemplazo: n es público; Δ₂ = 2C por paso en que participa el registro.' : 'Vecindad añadir/eliminar: Δ₂ = C por paso.',
      scheduleNote,
      'Las métricas de entrenamiento mostradas (calculadas sin ruido) NO están cubiertas por la garantía.',
      ...r.assumptions,
    ],
  };
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
  const scheduler = createBatchScheduler(train.length, cfg.batchSize, cfg.seed);
  const noiseRng = createSeededRng(deriveSeed(cfg.seed, 'noise'));
  const d = train[0]?.x.length ?? 2;
  let params = initParams(d);
  const B = cfg.batchSize;
  const history: TrainPoint[] = [];
  const traces: StepTrace[] = [];
  let gradEvals = 0;
  let clippedCount = 0;
  const record = (step: number) =>
    history.push({ step, trainLoss: bceLoss(params, train), testLoss: bceLoss(params, test), trainAcc: accuracy(params, train), testAcc: accuracy(params, test) });
  record(0);
  for (let t = 1; t <= cfg.steps; t++) {
    const batchIdx = scheduler.next();
    const batch = batchIdx.map((i) => train[i]);
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
