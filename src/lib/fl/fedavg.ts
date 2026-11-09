import { createSeededRng, deriveSeed } from '../rng/rng';
import { accuracy, bceLoss, initParams, sgdTrain, type Sample } from '../ml/logistic';
import { clipL2, norm2, sub, type Vec } from '../vec';
import { gaussianCompositionEpsilon, type PrivacyAccounting } from '../dp/accountant';
import type { FederatedData } from './data';
import { BYTES_PER_PARAM } from './communication';

export interface DPFedConfig {
  /** Norma de recorte C aplicada a la actualización Δ_k de cada cliente. */
  clipNorm: number;
  /** Multiplicador de ruido σ: ruido N(0, (σC)²) por coordenada añadido a la SUMA de actualizaciones. */
  noiseMultiplier: number;
  delta?: number;
}

export interface FedAvgConfig {
  rounds: number;
  localEpochs: number;
  localLr: number;
  batchSize: number;
  /** Fracción de clientes que participan en cada ronda (0, 1]. */
  participation: number;
  seed: number;
  dp?: DPFedConfig | null;
}

export interface ClientUpdate {
  clientId: number;
  nSamples: number;
  startParams: Vec;
  endParams: Vec;
  delta: Vec;
  deltaNorm: number;
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
  testAcc: number;
  testLoss: number;
  /** Pérdida de entrenamiento global (ponderada por n_k) evaluada con el modelo global. */
  trainLoss: number;
  perClientAcc: number[];
}

export interface RoundTrace {
  round: number;
  selected: number[];
  globalBefore: Vec;
  updates: ClientUpdate[];
  weights: AggregationWeight[];
  N: number;
  /** Resultado de la agregación ANTES de ruido (FedAvg: Σ n_k/N w_k; DP: w + media de Δ recortados). */
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
  accounting: PrivacyAccounting;
}

export function validateFedConfig(c: FedAvgConfig): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.rounds) || c.rounds < 1 || c.rounds > 500) e.push('Las rondas deben ser un entero entre 1 y 500.');
  if (!Number.isInteger(c.localEpochs) || c.localEpochs < 1 || c.localEpochs > 50) e.push('Las épocas locales deben estar entre 1 y 50.');
  if (!(c.localLr > 0) || c.localLr > 10) e.push('La tasa de aprendizaje local debe estar en (0, 10].');
  if (!Number.isInteger(c.batchSize) || c.batchSize < 1) e.push('El tamaño de lote debe ser un entero ≥ 1.');
  if (!(c.participation > 0 && c.participation <= 1)) e.push('La participación debe estar en (0, 100] %.');
  if (c.dp) {
    if (!(c.dp.clipNorm > 0)) e.push('La norma de recorte C debe ser positiva.');
    if (!(c.dp.noiseMultiplier >= 0)) e.push('El multiplicador de ruido no puede ser negativo.');
  }
  return e;
}

export function evaluate(params: Vec, data: FederatedData): RoundMetrics {
  const totalN = data.clients.reduce((s, c) => s + c.train.length, 0);
  const trainLoss = data.clients.reduce((s, c) => s + (c.train.length / totalN) * bceLoss(params, c.train), 0);
  return {
    testAcc: accuracy(params, data.globalTest),
    testLoss: bceLoss(params, data.globalTest),
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

export function selectClients(numClients: number, participation: number, seed: number, round: number): number[] {
  const m = numSelected(numClients, participation);
  const rng = createSeededRng(deriveSeed(seed, 'select', round));
  return rng
    .shuffle(Array.from({ length: numClients }, (_, i) => i))
    .slice(0, m)
    .sort((a, b) => a - b);
}

export function dpFedAccounting(c: FedAvgConfig, numClients: number): PrivacyAccounting {
  if (!c.dp) return { status: 'not-computed', reason: 'FedAvg sin DP no proporciona garantías de privacidad diferencial.' };
  if (c.dp.noiseMultiplier <= 0) return { status: 'not-computed', reason: 'σ = 0: sin ruido no hay garantía de privacidad diferencial.' };
  if (numSelected(numClients, c.participation) < numClients) {
    return {
      status: 'not-computed',
      reason:
        'Con participación parcial la garantía depende de la amplificación por muestreo de clientes, que no está implementada. Usa participación del 100 % para obtener una cota conservadora a nivel de cliente.',
    };
  }
  const r = gaussianCompositionEpsilon({ noiseMultiplier: c.dp.noiseMultiplier, steps: c.rounds, delta: c.dp.delta ?? 1e-3 });
  return {
    ...r,
    assumptions: [
      'Unidad de privacidad: el CLIENTE completo (todos sus registros).',
      'Servidor de agregación de confianza que añade el ruido (DP central); los clientes no añaden ruido.',
      ...r.assumptions,
    ],
  };
}

/**
 * Federated Averaging (McMahan et al. 2017). Con `dp`, variante DP-FedAvg a nivel de cliente
 * (McMahan et al. 2018): Δ_k recortado a norma C, media NO ponderada de Δ recortados y ruido
 * gaussiano N(0, σ²C²) sobre la suma, dividido por el número (público) de clientes seleccionados.
 */
export function runFedAvg(data: FederatedData, cfg: FedAvgConfig): FedAvgResult {
  const errs = validateFedConfig(cfg);
  if (errs.length) throw new RangeError(errs.join(' '));
  const d = data.clients[0].train[0]?.x.length ?? 2;
  const P = d + 1;
  const init = initParams(d);
  let global = init.slice();
  const rounds: RoundTrace[] = [];
  const initMetrics = evaluate(global, data);
  let totalBytes = 0;
  let totalGradEvals = 0;
  const noiseRng = createSeededRng(deriveSeed(cfg.seed, 'dp-noise'));
  for (let r = 1; r <= cfg.rounds; r++) {
    const selected = selectClients(data.clients.length, cfg.participation, cfg.seed, r);
    const updates: ClientUpdate[] = selected.map((k) => {
      const client = data.clients[k];
      const rng = createSeededRng(deriveSeed(cfg.seed, 'local', r, k));
      const lossBefore = bceLoss(global, client.train);
      const res = sgdTrain(global, client.train, cfg.localEpochs, cfg.localLr, cfg.batchSize, rng);
      const delta = sub(res.params, global);
      const deltaNorm = norm2(delta);
      const clippedDelta = cfg.dp ? clipL2(delta, cfg.dp.clipNorm) : null;
      return {
        clientId: k,
        nSamples: client.train.length,
        startParams: global.slice(),
        endParams: res.params,
        delta,
        deltaNorm,
        clippedDelta,
        wasClipped: !!cfg.dp && deltaNorm > cfg.dp.clipNorm,
        localLosses: res.epochLosses,
        lossBefore,
        gradEvals: res.gradEvals,
      };
    });
    totalGradEvals += updates.reduce((s, u) => s + u.gradEvals, 0);
    let aggregated: Vec;
    let noise: Vec | null = null;
    let globalAfter: Vec;
    let weights: AggregationWeight[];
    let N: number;
    if (!cfg.dp) {
      const agg = weightedAverage(
        updates.map((u) => u.endParams),
        updates.map((u) => u.nSamples),
      );
      aggregated = agg.params;
      N = agg.N;
      weights = updates.map((u, i) => ({ clientId: u.clientId, n: u.nSamples, weight: agg.weights[i] }));
      globalAfter = aggregated;
    } else {
      const m = updates.length;
      N = updates.reduce((s, u) => s + u.nSamples, 0);
      weights = updates.map((u) => ({ clientId: u.clientId, n: u.nSamples, weight: 1 / m }));
      const sum = new Array(P).fill(0);
      for (const u of updates) u.clippedDelta!.forEach((v, j) => (sum[j] += v));
      const sd = cfg.dp.noiseMultiplier * cfg.dp.clipNorm;
      noise = sum.map(() => (sd > 0 ? noiseRng.normal(0, sd) : 0));
      aggregated = global.map((g, j) => g + sum[j] / m);
      globalAfter = global.map((g, j) => g + (sum[j] + noise![j]) / m);
    }
    const bytesDown = selected.length * P * BYTES_PER_PARAM;
    const bytesUp = selected.length * P * BYTES_PER_PARAM;
    totalBytes += bytesDown + bytesUp;
    const trace: RoundTrace = {
      round: r,
      selected,
      globalBefore: global,
      updates,
      weights,
      N,
      aggregated,
      noise,
      globalAfter,
      metrics: evaluate(globalAfter, data),
      bytesDown,
      bytesUp,
    };
    rounds.push(trace);
    global = globalAfter;
  }
  return { init, initMetrics, rounds, finalParams: global, totalBytes, totalGradEvals, accounting: dpFedAccounting(cfg, data.clients.length) };
}

export interface CentralResult {
  history: { epoch: number; testAcc: number; testLoss: number; trainLoss: number }[];
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
  history.push({ epoch: 0, testAcc: m0.testAcc, testLoss: m0.testLoss, trainLoss: m0.trainLoss });
  let gradEvals = 0;
  for (let e = 1; e <= epochs; e++) {
    const res = sgdTrain(params, pooled, 1, lr, batchSize, rng);
    params = res.params;
    gradEvals += res.gradEvals;
    const m = evaluate(params, data);
    history.push({ epoch: e, testAcc: m.testAcc, testLoss: m.testLoss, trainLoss: m.trainLoss });
  }
  return { history, params, gradEvals, rawDataBytes: pooled.length * (d + 1) * BYTES_PER_PARAM };
}
