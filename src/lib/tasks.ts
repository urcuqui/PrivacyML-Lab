/**
 * Tareas de simulación potencialmente costosas. Se ejecutan en un Web Worker
 * (src/workers/sim.worker.ts) y, si no está disponible, en el hilo principal.
 * Todas son funciones puras y deterministas dada la semilla.
 */
import { createSeededRng, deriveSeed } from './rng/rng';
import { simulateLaplace } from './dp/laplace';
import { mean, std, ci95, quantile } from './stats';
import { generateFederatedData, type FederatedDataConfig } from './fl/data';
import { runCentralized, runFedAvg, dpFedAccounting, type FedAvgConfig, type DPFedConfig, type FedAvgResult } from './fl/fedavg';
import type { Adjacency } from './privacy/model';

export interface DpUtilitySweepInput {
  epsilons: number[];
  sensitivity: number;
  trueValue: number;
  reps: number;
  seed: number;
}
export interface DpUtilityRow {
  epsilon: number;
  scale: number;
  mae: number;
  maeStd: number;
  maeCi95: number;
  errP10: number;
  errP90: number;
  theoreticalMAE: number;
}
export function dpUtilitySweep(i: DpUtilitySweepInput): DpUtilityRow[] {
  return i.epsilons.map((eps) => {
    const rng = createSeededRng(deriveSeed(i.seed, 'sweep', eps));
    const s = simulateLaplace(i.trueValue, i.sensitivity, eps, i.reps, rng);
    return {
      epsilon: eps,
      scale: s.scale,
      mae: s.meanAbsError,
      maeStd: s.stdAbsError,
      maeCi95: ci95(s.absErrors),
      errP10: quantile(s.absErrors, 0.1),
      errP90: quantile(s.absErrors, 0.9),
      theoreticalMAE: s.theoreticalMAE,
    };
  });
}

export interface IidCompareInput {
  data: FederatedDataConfig;
  fed: FedAvgConfig;
  repeats: number;
}
export interface ModeSummary {
  mode: 'iid' | 'non-iid';
  perRound: { round: number; accMean: number; accStd: number; refAccMean: number; refAccStd: number; lossMean: number; lossStd: number }[];
  /** Precisión final en la evaluación del propio escenario (una por repetición). */
  finalAcc: number[];
  /** Precisión final en el conjunto de REFERENCIA común (una por repetición). */
  finalRefAcc: number[];
  perClientAccMean: number[];
  perClientAccStd: number[];
  /** Ronda en la que se alcanza por primera vez el 95 % de la precisión final (media por repetición). */
  roundsTo95: number[];
  clientPositiveRates: number[];
}
export function iidCompare(input: IidCompareInput): ModeSummary[] {
  return (['iid', 'non-iid'] as const).map((mode) => {
    const runs = Array.from({ length: input.repeats }, (_, r) => {
      const seed = deriveSeed(input.data.seed, 'rep', r);
      const data = generateFederatedData({ ...input.data, mode, seed });
      const res = runFedAvg(data, { ...input.fed, seed: deriveSeed(input.fed.seed, 'rep', r) });
      return { data, res };
    });
    const R = input.fed.rounds;
    const perRound = Array.from({ length: R + 1 }, (_, t) => {
      const accs = runs.map(({ res }) => (t === 0 ? res.initMetrics.testAcc : res.rounds[t - 1].metrics.testAcc));
      const refs = runs.map(({ res }) => (t === 0 ? res.initMetrics.refAcc : res.rounds[t - 1].metrics.refAcc));
      const losses = runs.map(({ res }) => (t === 0 ? res.initMetrics.trainLoss : res.rounds[t - 1].metrics.trainLoss));
      return { round: t, accMean: mean(accs), accStd: std(accs), refAccMean: mean(refs), refAccStd: std(refs), lossMean: mean(losses), lossStd: std(losses) };
    });
    const finalAcc = runs.map(({ res }) => res.rounds[R - 1].metrics.testAcc);
    const finalRefAcc = runs.map(({ res }) => res.rounds[R - 1].metrics.refAcc);
    const K = input.data.numClients;
    const perClient = Array.from({ length: K }, (_, k) => runs.map(({ res }) => res.rounds[R - 1].metrics.perClientAcc[k]));
    const roundsTo95 = runs.map(({ res }) => {
      const fin = res.rounds[R - 1].metrics.testAcc;
      const idx = res.rounds.findIndex((rt) => rt.metrics.testAcc >= 0.95 * fin);
      return idx + 1;
    });
    return {
      mode,
      perRound,
      finalAcc,
      finalRefAcc,
      perClientAccMean: perClient.map(mean),
      perClientAccStd: perClient.map((a) => std(a)),
      roundsTo95,
      clientPositiveRates: runs[0].data.clients.map((c) => c.positiveRate),
    };
  });
}

export interface CommGridInput {
  data: FederatedDataConfig;
  fed: FedAvgConfig;
  localEpochsList: number[];
  participationList: number[];
  targetAcc: number;
}
export interface CommGridCell {
  localEpochs: number;
  participation: number;
  roundsToTarget: number | null;
  bytesToTarget: number | null;
  gradEvalsToTarget: number | null;
  finalAcc: number;
  totalBytes: number;
  totalGradEvals: number;
}
export function commGrid(input: CommGridInput): CommGridCell[] {
  const data = generateFederatedData(input.data);
  const cells: CommGridCell[] = [];
  for (const E of input.localEpochsList) {
    for (const p of input.participationList) {
      const res = runFedAvg(data, { ...input.fed, localEpochs: E, participation: p, dp: null });
      let bytes = 0;
      let grads = 0;
      let reached: number | null = null;
      let bytesTo: number | null = null;
      let gradsTo: number | null = null;
      for (const rt of res.rounds) {
        bytes += rt.bytesDown + rt.bytesUp;
        grads += rt.updates.reduce((s, u) => s + u.gradEvals, 0);
        if (reached === null && rt.metrics.testAcc >= input.targetAcc) {
          reached = rt.round;
          bytesTo = bytes;
          gradsTo = grads;
        }
      }
      cells.push({
        localEpochs: E,
        participation: p,
        roundsToTarget: reached,
        bytesToTarget: bytesTo,
        gradEvalsToTarget: gradsTo,
        finalAcc: res.rounds[res.rounds.length - 1].metrics.testAcc,
        totalBytes: res.totalBytes,
        totalGradEvals: res.totalGradEvals,
      });
    }
  }
  return cells;
}

export interface CombinedInput {
  data: FederatedDataConfig;
  fed: FedAvgConfig;
  dp: DPFedConfig;
  /** Repeticiones del RUIDO (solo cambia la semilla del ruido; datos, selección y entrenamiento local idénticos). */
  noiseRepeats?: number;
}
export interface CombinedSeriesPoint {
  round: number;
  central: number;
  /** B1 — FedAvg ponderado (n_k/N). */
  fedavg: number;
  /** B2 — FedAvg uniforme (1/m̄), sin recorte ni ruido. */
  uniform: number;
  /** C — FedAvg uniforme con recorte, sin ruido (NO es DP). */
  clipped: number;
  /** D — DP-FedAvg: media sobre las repeticiones de ruido. */
  dpfed: number;
  dpfedStd: number;
  centralLoss: number;
  fedavgLoss: number;
  uniformLoss: number;
  clippedLoss: number;
  dpfedLoss: number;
}

function finalAccOf(res: FedAvgResult): number {
  return res.rounds[res.rounds.length - 1].metrics.testAcc;
}
function metricsAt(res: FedAvgResult, r: number) {
  return r === 0 ? res.initMetrics : res.rounds[r - 1].metrics;
}

/**
 * Comparación CONTROLADA (mismos datos, misma selección de clientes, mismo entrenamiento local):
 *   A  centralizado (referencia)
 *   B1 FedAvg ponderado n_k/N        — sin recorte ni ruido
 *   B2 FedAvg uniforme 1/m̄           — aísla el efecto de la PONDERACIÓN (B2 − B1)
 *   C  uniforme + recorte a C        — aísla el efecto del RECORTE (C − B2); NO es DP
 *   D  uniforme + recorte + ruido    — aísla el efecto del RUIDO (D − C), repetido con R semillas de ruido
 * La descomposición es SECUENCIAL: con interacciones, otro orden podría repartir la diferencia de otra forma.
 */
export function combinedCompare(input: CombinedInput) {
  const data = generateFederatedData(input.data);
  const base: FedAvgConfig = { ...input.fed, dp: null, clipNorm: null };
  const weighted = runFedAvg(data, { ...base, aggregation: 'weighted' });
  const uniform = runFedAvg(data, { ...base, aggregation: 'uniform' });
  const clipped = runFedAvg(data, { ...base, aggregation: 'uniform', clipNorm: input.dp.clipNorm });
  const R = Math.max(1, Math.min(50, Math.round(input.noiseRepeats ?? 5)));
  const dpRuns = Array.from({ length: R }, (_, r) =>
    runFedAvg(data, { ...base, aggregation: undefined, dp: input.dp, noiseSeed: deriveSeed(input.fed.seed, 'noise-rep', r) }),
  );
  const dpfed = dpRuns[0];
  // Centralizado: mismo número total de pasadas por los datos que un cliente con participación total.
  const epochs = input.fed.rounds * input.fed.localEpochs;
  const central = runCentralized(data, epochs, input.fed.localLr, input.fed.batchSize, input.fed.seed);
  const series: CombinedSeriesPoint[] = [];
  for (let r = 0; r <= input.fed.rounds; r++) {
    const c = central.history[r * input.fed.localEpochs];
    const dpAccs = dpRuns.map((x) => metricsAt(x, r).testAcc);
    series.push({
      round: r,
      central: c.testAcc,
      fedavg: metricsAt(weighted, r).testAcc,
      uniform: metricsAt(uniform, r).testAcc,
      clipped: metricsAt(clipped, r).testAcc,
      dpfed: mean(dpAccs),
      dpfedStd: std(dpAccs),
      centralLoss: c.trainLoss,
      fedavgLoss: metricsAt(weighted, r).trainLoss,
      uniformLoss: metricsAt(uniform, r).trainLoss,
      clippedLoss: metricsAt(clipped, r).trainLoss,
      dpfedLoss: mean(dpRuns.map((x) => metricsAt(x, r).trainLoss)),
    });
  }
  const meanUpdateNorm = (res: FedAvgResult) => mean(res.rounds.flatMap((rt) => rt.updates.map((u) => u.deltaNorm)));
  const clippedFraction = (res: FedAvgResult) => mean(res.rounds.flatMap((rt) => rt.updates.map((u) => (u.wasClipped ? 1 : 0))));
  const dpFinals = dpRuns.map(finalAccOf);
  const accW = finalAccOf(weighted);
  const accU = finalAccOf(uniform);
  const accC = finalAccOf(clipped);
  const accD = mean(dpFinals);
  const mBar = dpfed.rounds[0].publicDenominator ?? dpfed.rounds[0].selected.length;
  return {
    series,
    noiseRepeats: R,
    central: { finalAcc: central.history[central.history.length - 1].testAcc, gradEvals: central.gradEvals, rawDataBytes: central.rawDataBytes, epochs },
    fedavg: { finalAcc: accW, gradEvals: weighted.totalGradEvals, bytes: weighted.totalBytes, meanUpdateNorm: meanUpdateNorm(weighted), finalParams: weighted.finalParams },
    uniform: { finalAcc: accU, gradEvals: uniform.totalGradEvals, bytes: uniform.totalBytes, meanUpdateNorm: meanUpdateNorm(uniform), finalParams: uniform.finalParams },
    clipped: {
      finalAcc: accC,
      gradEvals: clipped.totalGradEvals,
      bytes: clipped.totalBytes,
      meanUpdateNorm: meanUpdateNorm(clipped),
      clippedFraction: clippedFraction(clipped),
      finalParams: clipped.finalParams,
    },
    dpfed: {
      /** Media de la precisión final sobre las R repeticiones de ruido. */
      finalAcc: accD,
      finalAccStd: std(dpFinals),
      finalAccs: dpFinals,
      gradEvals: dpfed.totalGradEvals,
      bytes: dpfed.totalBytes,
      meanUpdateNorm: meanUpdateNorm(dpfed),
      clippedFraction: clippedFraction(dpfed),
      publicDenominator: mBar,
      /** Desviación típica del ruido por coordenada en el modelo global: σC / m̄. */
      noiseStdPerCoord: (input.dp.noiseMultiplier * input.dp.clipNorm) / mBar,
      accounting: dpfed.accounting,
      finalParams: dpfed.finalParams,
    },
    /** Descomposición secuencial (empírica) de la diferencia de precisión B1 → D. */
    decomposition: {
      weighting: accU - accW,
      clipping: accC - accU,
      noise: accD - accC,
      noiseStd: std(dpFinals.map((a) => a - accC)),
      total: accD - accW,
    },
    centralParams: central.params,
    clientSizes: data.clients.map((c) => c.train.length),
  };
}
export type CombinedResult = ReturnType<typeof combinedCompare>;

export interface DpflSweepInput {
  data: FederatedDataConfig;
  fed: FedAvgConfig;
  noiseMultipliers: number[];
  clipNorms: number[];
  repeats: number;
  delta: number;
  adjacency?: Adjacency;
}
export interface DpflSweepRow {
  noiseMultiplier: number;
  clipNorm: number;
  accMean: number;
  accStd: number;
  /** ε solo si la contabilidad es válida para esta configuración (σ > 0 y vecindad/participación admitidas). */
  epsilon: number | null;
}
/**
 * Barrido privacidad–utilidad. En cada repetición solo cambia la SEMILLA DEL RUIDO: los datos, la
 * selección de clientes y el entrenamiento local son idénticos, así la variabilidad mostrada es la del ruido.
 * Las filas con σ = 0 son "solo recorte" (no DP).
 */
export function dpflSweep(input: DpflSweepInput): { rows: DpflSweepRow[]; baselineAcc: number; uniformAcc: number } {
  const data = generateFederatedData(input.data);
  const base: FedAvgConfig = { ...input.fed, dp: null, clipNorm: null };
  const baseline = runFedAvg(data, { ...base, aggregation: 'weighted' });
  const uniform = runFedAvg(data, { ...base, aggregation: 'uniform' });
  const rows: DpflSweepRow[] = [];
  for (const C of input.clipNorms) {
    for (const s of input.noiseMultipliers) {
      const dp: DPFedConfig = { clipNorm: C, noiseMultiplier: s, delta: input.delta, adjacency: input.adjacency };
      const accs = Array.from({ length: s > 0 ? input.repeats : 1 }, (_, r) =>
        finalAccOf(runFedAvg(data, { ...base, aggregation: undefined, dp, noiseSeed: deriveSeed(input.fed.seed, 'sweep-noise', r) })),
      );
      const acc = dpFedAccounting({ ...base, dp }, input.data.numClients);
      rows.push({ noiseMultiplier: s, clipNorm: C, accMean: mean(accs), accStd: std(accs), epsilon: acc.status === 'computed' ? acc.epsilon : null });
    }
  }
  return { rows, baselineAcc: finalAccOf(baseline), uniformAcc: finalAccOf(uniform) };
}

export const TASKS = {
  dpUtilitySweep,
  iidCompare,
  commGrid,
  combinedCompare,
  dpflSweep,
} as const;
export type TaskName = keyof typeof TASKS;
export type TaskInput<K extends TaskName> = Parameters<(typeof TASKS)[K]>[0];
export type TaskOutput<K extends TaskName> = ReturnType<(typeof TASKS)[K]>;
