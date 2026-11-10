import { createSeededRng, deriveSeed } from '../rng/rng';
import { accuracy, bceLoss, initParams, sgdTrain, type Sample } from '../ml/logistic';
import { clipL2, norm2, sub, type Vec } from '../vec';
import { gaussianCompositionEpsilon, type PrivacyAccounting } from '../dp/accountant';
import { clippedSumSensitivityMultiple, type Adjacency } from '../privacy/model';
import type { FederatedData } from './data';
import { BYTES_PER_PARAM } from './communication';

export interface DPFedConfig {
  /** Norma de recorte C aplicada a la actualización Δ_k de cada cliente. */
  clipNorm: number;
  /** Multiplicador de ruido σ: ruido N(0, (σC)²) por coordenada añadido a la SUMA de actualizaciones. */
  noiseMultiplier: number;
  delta?: number;
  /** Vecindad a nivel de CLIENTE usada para la contabilidad (por defecto añadir/eliminar). */
  adjacency?: Adjacency;
}

/**
 * Regla de ponderación de la agregación:
 * - 'weighted': FedAvg estándar, pesos n_k / N (N = muestras de los participantes).
 * - 'uniform':  todos los participantes pesan 1/m̄, con m̄ = número de clientes por ronda (constante pública).
 */
export type Aggregation = 'weighted' | 'uniform';

export interface FedAvgConfig {
  rounds: number;
  localEpochs: number;
  localLr: number;
  batchSize: number;
  /** Fracción de clientes que participan en cada ronda (0, 1]. */
  participation: number;
  seed: number;
  /** Ponderación (por defecto 'weighted'; con `dp` siempre es 'uniform'). */
  aggregation?: Aggregation;
  /** Recorte de Δ_k SIN ruido (no es privacidad diferencial). Se ignora si hay `dp`. */
  clipNorm?: number | null;
  /** DP-FedAvg: recorte + ponderación uniforme + ruido gaussiano. */
  dp?: DPFedConfig | null;
  /**
   * Semilla SOLO del ruido gaussiano (por defecto se deriva de `seed`). Permite repetir el ruido
   * manteniendo idénticos la selección de clientes y el entrenamiento local.
   */
  noiseSeed?: number;
}

export interface ClientUpdate {
  clientId: number;
  nSamples: number;
  startParams: Vec;
  endParams: Vec;
  delta: Vec;
  deltaNorm: number;
  /** Δ_k recortado (solo si hay recorte o DP). */
  clippedDelta: Vec | null;
  wasClipped: boolean;
  localLosses: number[];
  lossBefore: number;
  gradEvals: number;
}

export interface AggregationWeight {
  clientId: number;
  n: number;
  weight: number;
}

export interface RoundMetrics {
  /** Precisión en el conjunto de evaluación del ESCENARIO (mezcla de las distribuciones de sus clientes). */
  testAcc: number;
  testLoss: number;
  /** Precisión en el conjunto de REFERENCIA común (idéntico para todos los escenarios). */
  refAcc: number;
  refLoss: number;
  /** Pérdida de entrenamiento global (ponderada por n_k) evaluada con el modelo global. Instrumentación: usa datos privados sin ruido. */
  trainLoss: number;
  /** Precisión local por cliente. Instrumentación: usa datos privados sin ruido. */
  perClientAcc: number[];
}

export interface RoundTrace {
  round: number;
  selected: number[];
  globalBefore: Vec;
  updates: ClientUpdate[];
  aggregation: Aggregation;
  weights: AggregationWeight[];
  N: number;
  /** Denominador público m̄ (solo en agregación uniforme). */
  publicDenominator: number | null;
  /** Resultado de la agregación ANTES de ruido. */
  aggregated: Vec;
  noise: Vec | null;
  globalAfter: Vec;
  metrics: RoundMetrics;
  bytesDown: number;
  bytesUp: number;
}

export interface FedAvgResult {
  init: Vec;
  initMetrics: RoundMetrics;
  rounds: RoundTrace[];
  finalParams: Vec;
  totalBytes: number;
  totalGradEvals: number;
  aggregation: Aggregation;
  accounting: PrivacyAccounting;
}

export function effectiveAggregation(c: FedAvgConfig): Aggregation {
  return c.dp ? 'uniform' : (c.aggregation ?? 'weighted');
}

export function validateFedConfig(c: FedAvgConfig): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.rounds) || c.rounds < 1 || c.rounds > 500) e.push('Las rondas deben ser un entero entre 1 y 500.');
  if (!Number.isInteger(c.localEpochs) || c.localEpochs < 1 || c.localEpochs > 50) e.push('Las épocas locales deben estar entre 1 y 50.');
  if (!(c.localLr > 0) || c.localLr > 10) e.push('La tasa de aprendizaje local debe estar en (0, 10].');
  if (!Number.isInteger(c.batchSize) || c.batchSize < 1) e.push('El tamaño de lote debe ser un entero ≥ 1.');
  if (!(c.participation > 0 && c.participation <= 1)) e.push('La participación debe estar en (0, 100] %.');
  if (c.clipNorm != null && !(c.clipNorm > 0)) e.push('La norma de recorte debe ser positiva.');
  if (c.dp) {
    if (!(c.dp.clipNorm > 0)) e.push('La norma de recorte C debe ser positiva.');
    if (!(c.dp.noiseMultiplier >= 0)) e.push('El multiplicador de ruido no puede ser negativo.');
    if (c.aggregation === 'weighted')
      e.push('DP-FedAvg usa ponderación uniforme: con pesos n_k/N un cliente grande tendría sensibilidad mayor que C/m̄ y además n_k sería información privada.');
  }
  return e;
}

export function evaluate(params: Vec, data: FederatedData): RoundMetrics {
  const totalN = data.clients.reduce((s, c) => s + c.train.length, 0);
  const trainLoss = data.clients.reduce((s, c) => s + (c.train.length / totalN) * bceLoss(params, c.train), 0);
  return {
    testAcc: accuracy(params, data.globalTest),
    testLoss: bceLoss(params, data.globalTest),
    refAcc: accuracy(params, data.referenceTest),
    refLoss: bceLoss(params, data.referenceTest),
    trainLoss,
    perClientAcc: data.clients.map((c) => accuracy(params, c.test)),
  };
}

/** Media ponderada FedAvg: w = Σ_k (n_k / N) · w_k, con N = Σ n_k de los participantes. */
export function weightedAverage(models: readonly Vec[], counts: readonly number[]): { params: Vec; weights: number[]; N: number } {
  if (!models.length) throw new RangeError('Se necesita al menos un modelo para agregar');
  if (models.length !== counts.length) throw new RangeError('models y counts deben tener la misma longitud');
  const N = counts.reduce((a, b) => a + b, 0);
  if (!(N > 0)) throw new RangeError('N debe ser positivo');
  const weights = counts.map((n) => n / N);
  const params = new Array(models[0].length).fill(0);
  models.forEach((m, k) => m.forEach((v, j) => (params[j] += weights[k] * v)));
  return { params, weights, N };
}

export function numSelected(numClients: number, participation: number): number {
  return Math.max(1, Math.min(numClients, Math.round(participation * numClients)));
}

/** Selección de clientes: depende solo de (K, participación, semilla, ronda), nunca de los datos. */
export function selectClients(numClients: number, participation: number, seed: number, round: number): number[] {
  const m = numSelected(numClients, participation);
  const rng = createSeededRng(deriveSeed(seed, 'select', round));
  return rng
    .shuffle(Array.from({ length: numClients }, (_, i) => i))
    .slice(0, m)
    .sort((a, b) => a - b);
}

/**
 * Contabilidad de DP-FedAvg (privacidad a nivel de CLIENTE, DP central con servidor de confianza).
 *
 * El servidor publica w_{t+1} = w_t + (Σ_k clip(Δ_k, C) + N(0, σ²C²I)) / m̄ con m̄ CONSTANTE pública.
 * - Añadir/eliminar + participación total: añadir/eliminar un cliente cambia la suma en ≤ C ⇒ T rondas, Δ₂ = C.
 * - Añadir/eliminar + participación parcial: la selección de tamaño fijo depende de K (que cambia entre
 *   vecinos) y la amplificación por muestreo no está implementada ⇒ "No calculado".
 * - Reemplazar (K público): la selección no depende de los datos; en cada ronda el cliente participa
 *   (Δ₂ ≤ 2C) o no (divergencia 0). En el peor caso participa en las T rondas ⇒ T composiciones con 2C.
 */
export function dpFedAccounting(c: FedAvgConfig, numClients: number): PrivacyAccounting {
  if (!c.dp) return { status: 'not-computed', reason: 'FedAvg sin ruido calibrado no proporciona garantías de privacidad diferencial (el recorte por sí solo tampoco).' };
  if (!(c.dp.noiseMultiplier > 0)) return { status: 'not-computed', reason: 'σ = 0: el recorte sin ruido no es privacidad diferencial.' };
  const adjacency = c.dp.adjacency ?? 'add-remove';
  const full = numSelected(numClients, c.participation) >= numClients;
  if (adjacency === 'add-remove' && !full) {
    return {
      status: 'not-computed',
      reason:
        'Con vecindad añadir/eliminar y participación parcial, la selección de m̄ clientes depende de K (que cambia entre federaciones vecinas) y la garantía ajustada requiere amplificación por muestreo de clientes, no implementada. Usa participación del 100 % o la vecindad por reemplazo (K público) para obtener una cota conservadora.',
    };
  }
  const k = clippedSumSensitivityMultiple(adjacency);
  const r = gaussianCompositionEpsilon({ noiseMultiplier: c.dp.noiseMultiplier, steps: c.rounds, delta: c.dp.delta ?? 1e-3, sensitivityMultiple: k });
  return {
    ...r,
    assumptions: [
      'Unidad de privacidad: el CLIENTE completo (todos sus registros).',
      adjacency === 'replace'
        ? 'Vecindad por reemplazo: K es público y la selección de clientes no depende de los datos; Δ₂ = 2C en cada ronda en que participa el cliente (peor caso: las T rondas).'
        : 'Vecindad añadir/eliminar con participación total: Δ₂ = C por ronda.',
      'El denominador m̄ (clientes por ronda) es una constante pública fijada de antemano, no el número de actualizaciones recibidas.',
      'Servidor de agregación de CONFIANZA (DP central): ve cada Δ_k en claro. La garantía protege frente a observadores de los modelos globales publicados, NO frente al servidor.',
      'Las métricas de entrenamiento y la precisión local por cliente mostradas NO están cubiertas por la garantía.',
      ...r.assumptions,
    ],
  };
}

/**
 * Federated Averaging (McMahan et al. 2017) con variantes controladas para aislar efectos:
 *  - aggregation 'weighted' (por defecto): w ← Σ (n_k/N) w_k
 *  - aggregation 'uniform':               w ← w + (1/m̄) Σ Δ_k
 *  - clipNorm (sin ruido):                Δ_k ← clip(Δ_k, C)       (NO es DP)
 *  - dp (DP-FedAvg, McMahan et al. 2018): w ← w + (Σ clip(Δ_k, C) + N(0, σ²C²I)) / m̄
 */
export function runFedAvg(data: FederatedData, cfg: FedAvgConfig): FedAvgResult {
  const errs = validateFedConfig(cfg);
  if (errs.length) throw new RangeError(errs.join(' '));
  const d = data.clients[0].train[0]?.x.length ?? 2;
  const P = d + 1;
  const K = data.clients.length;
  const aggregation = effectiveAggregation(cfg);
  const clip = cfg.dp ? cfg.dp.clipNorm : (cfg.clipNorm ?? null);
  /** m̄: constante pública (número configurado de clientes por ronda). */
  const mBar = numSelected(K, cfg.participation);
  const init = initParams(d);
  let global = init.slice();
  const rounds: RoundTrace[] = [];
  const initMetrics = evaluate(global, data);
  let totalBytes = 0;
  let totalGradEvals = 0;
  const noiseRng = createSeededRng(deriveSeed(cfg.noiseSeed ?? cfg.seed, 'dp-noise'));
  for (let r = 1; r <= cfg.rounds; r++) {
    const selected = selectClients(K, cfg.participation, cfg.seed, r);
    const updates: ClientUpdate[] = selected.map((k) => {
      const client = data.clients[k];
      const rng = createSeededRng(deriveSeed(cfg.seed, 'local', r, k));
      const lossBefore = bceLoss(global, client.train);
      const res = sgdTrain(global, client.train, cfg.localEpochs, cfg.localLr, cfg.batchSize, rng);
      const delta = sub(res.params, global);
      const deltaNorm = norm2(delta);
      const clippedDelta = clip !== null ? clipL2(delta, clip) : null;
      return {
        clientId: k,
        nSamples: client.train.length,
        startParams: global.slice(),
        endParams: res.params,
        delta,
        deltaNorm,
        clippedDelta,
        wasClipped: clip !== null && deltaNorm > clip,
        localLosses: res.epochLosses,
        lossBefore,
        gradEvals: res.gradEvals,
      };
    });
    totalGradEvals += updates.reduce((s, u) => s + u.gradEvals, 0);
    const contribution = (u: ClientUpdate) => u.clippedDelta ?? u.delta;
    const N = updates.reduce((s, u) => s + u.nSamples, 0);
    let aggregated: Vec;
    let weights: AggregationWeight[];
    if (aggregation === 'weighted') {
      if (clip === null) {
        // Forma clásica: media ponderada de los modelos locales.
        const agg = weightedAverage(
          updates.map((u) => u.endParams),
          updates.map((u) => u.nSamples),
        );
        aggregated = agg.params;
        weights = updates.map((u, i) => ({ clientId: u.clientId, n: u.nSamples, weight: agg.weights[i] }));
      } else {
        weights = updates.map((u) => ({ clientId: u.clientId, n: u.nSamples, weight: u.nSamples / N }));
        aggregated = global.map((g, j) => g + updates.reduce((s, u, i) => s + weights[i].weight * contribution(u)[j], 0));
      }
    } else {
      weights = updates.map((u) => ({ clientId: u.clientId, n: u.nSamples, weight: 1 / mBar }));
      aggregated = global.map((g, j) => g + updates.reduce((s, u) => s + contribution(u)[j], 0) / mBar);
    }
    let noise: Vec | null = null;
    let globalAfter = aggregated;
    if (cfg.dp) {
      const sd = cfg.dp.noiseMultiplier * cfg.dp.clipNorm;
      noise = aggregated.map(() => (sd > 0 ? noiseRng.normal(0, sd) : 0));
      globalAfter = aggregated.map((a, j) => a + noise![j] / mBar);
    }
    const bytesDown = selected.length * P * BYTES_PER_PARAM;
    const bytesUp = selected.length * P * BYTES_PER_PARAM;
    totalBytes += bytesDown + bytesUp;
    rounds.push({
      round: r,
      selected,
      globalBefore: global,
      updates,
      aggregation,
      weights,
      N,
      publicDenominator: aggregation === 'uniform' ? mBar : null,
      aggregated,
      noise,
      globalAfter,
      metrics: evaluate(globalAfter, data),
      bytesDown,
      bytesUp,
    });
    global = globalAfter;
  }
  return { init, initMetrics, rounds, finalParams: global, totalBytes, totalGradEvals, aggregation, accounting: dpFedAccounting(cfg, K) };
}

export interface CentralResult {
  history: { epoch: number; testAcc: number; testLoss: number; refAcc: number; trainLoss: number }[];
  params: Vec;
  gradEvals: number;
  /** Bytes de datos brutos enviados al servidor (cada muestra: d características + etiqueta, float32). */
  rawDataBytes: number;
}

/** Entrenamiento centralizado: los datos se agregan en un servidor y se entrena con SGD. */
export function runCentralized(data: FederatedData, epochs: number, lr: number, batchSize: number, seed: number): CentralResult {
  const pooled: Sample[] = data.clients.flatMap((c) => c.train);
  const d = pooled[0].x.length;
  const rng = createSeededRng(deriveSeed(seed, 'central'));
  let params = initParams(d);
  const history: CentralResult['history'] = [];
  const m0 = evaluate(params, data);
  history.push({ epoch: 0, testAcc: m0.testAcc, testLoss: m0.testLoss, refAcc: m0.refAcc, trainLoss: m0.trainLoss });
  let gradEvals = 0;
  for (let e = 1; e <= epochs; e++) {
    const res = sgdTrain(params, pooled, 1, lr, batchSize, rng);
    params = res.params;
    gradEvals += res.gradEvals;
    const m = evaluate(params, data);
    history.push({ epoch: e, testAcc: m.testAcc, testLoss: m.testLoss, refAcc: m.refAcc, trainLoss: m.trainLoss });
  }
  return { history, params, gradEvals, rawDataBytes: pooled.length * (d + 1) * BYTES_PER_PARAM };
}
