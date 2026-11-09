/**
 * Tareas de simulación potencialmente costosas. Se ejecutan en un Web Worker
 * (src/workers/sim.worker.ts) y, si no está disponible, en el hilo principal.
 * Todas son funciones puras y deterministas dada la semilla.
 */
import { createSeededRng, deriveSeed } from './rng/rng';
import { simulateLaplace } from './dp/laplace';
import { mean, std, ci95, quantile } from './stats';
import { generateFederatedData, type FederatedDataConfig } from './fl/data';
import { runCentralized, runFedAvg, type FedAvgConfig, type DPFedConfig } from './fl/fedavg';
import { gaussianCompositionEpsilon } from './dp/accountant';

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
  perRound: { round: number; accMean: number; accStd: number; lossMean: number; lossStd: number }[];
  finalAcc: number[];
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
      const losses = runs.map(({ res }) => (t === 0 ? res.initMetrics.trainLoss : res.rounds[t - 1].metrics.trainLoss));
      return { round: t, accMean: mean(accs), accStd: std(accs), lossMean: mean(losses), lossStd: std(losses) };
    });
    const finalAcc = runs.map(({ res }) => res.rounds[R - 1].metrics.testAcc);
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
}
export interface CombinedSeriesPoint {
  round: number;
  central: number;
  fedavg: number;
  dpfed: number;
  centralLoss: number;
  fedavgLoss: number;
  dpfedLoss: number;
}
export function combinedCompare(input: CombinedInput) {
  const data = generateFederatedData(input.data);
  const fed = runFedAvg(data, { ...input.fed, dp: null });
  const dpfed = runFedAvg(data, { ...input.fed, dp: input.dp });
  // Centralizado: mismo número total de pasadas por los datos que un cliente con participación total.
  const epochs = input.fed.rounds * input.fed.localEpochs;
  const central = runCentralized(data, epochs, input.fed.localLr, input.fed.batchSize, input.fed.seed);
  const series: CombinedSeriesPoint[] = [];
  for (let r = 0; r <= input.fed.rounds; r++) {
    const c = central.history[r * input.fed.localEpochs];
    const f = r === 0 ? fed.initMetrics : fed.rounds[r - 1].metrics;
    const p = r === 0 ? dpfed.initMetrics : dpfed.rounds[r - 1].metrics;
    series.push({ round: r, central: c.testAcc, fedavg: f.testAcc, dpfed: p.testAcc, centralLoss: c.trainLoss, fedavgLoss: f.trainLoss, dpfedLoss: p.trainLoss });
  }
  const meanUpdateNorm = (res: typeof fed) => mean(res.rounds.flatMap((rt) => rt.updates.map((u) => u.deltaNorm)));
  const clippedFrac = mean(dpfed.rounds.flatMap((rt) => rt.updates.map((u) => (u.wasClipped ? 1 : 0))));
  return {
    series,
    central: { finalAcc: central.history[central.history.length - 1].testAcc, gradEvals: central.gradEvals, rawDataBytes: central.rawDataBytes, epochs },
    fedavg: { finalAcc: fed.rounds[fed.rounds.length - 1].metrics.testAcc, gradEvals: fed.totalGradEvals, bytes: fed.totalBytes, meanUpdateNorm: meanUpdateNorm(fed), finalParams: fed.finalParams },
    dpfed: {
      finalAcc: dpfed.rounds[dpfed.rounds.length - 1].metrics.testAcc,
      gradEvals: dpfed.totalGradEvals,
      bytes: dpfed.totalBytes,
      meanUpdateNorm: meanUpdateNorm(dpfed),
      clippedFraction: clippedFrac,
      noiseStdPerCoord: (input.dp.noiseMultiplier * input.dp.clipNorm) / Math.max(1, dpfed.rounds[0].selected.length),
      accounting: dpfed.accounting,
      finalParams: dpfed.finalParams,
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
}
export interface DpflSweepRow {
  noiseMultiplier: number;
  clipNorm: number;
  accMean: number;
  accStd: number;
  epsilon: number | null;
}
export function dpflSweep(input: DpflSweepInput): { rows: DpflSweepRow[]; baselineAcc: number } {
  const data = generateFederatedData(input.data);
  const baseline = runFedAvg(data, { ...input.fed, dp: null });
  const rows: DpflSweepRow[] = [];
  const full = Math.round(input.fed.participation * input.data.numClients) >= input.data.numClients;
  for (const C of input.clipNorms) {
    for (const s of input.noiseMultipliers) {
      const accs = Array.from({ length: input.repeats }, (_, r) => {
        const res = runFedAvg(data, { ...input.fed, seed: deriveSeed(input.fed.seed, 'sweep-rep', r), dp: { clipNorm: C, noiseMultiplier: s, delta: input.delta } });
        return res.rounds[res.rounds.length - 1].metrics.testAcc;
      });
      const epsilon = full && s > 0 ? gaussianCompositionEpsilon({ noiseMultiplier: s, steps: input.fed.rounds, delta: input.delta }).epsilon : null;
      rows.push({ noiseMultiplier: s, clipNorm: C, accMean: mean(accs), accStd: std(accs), epsilon });
    }
  }
  return { rows, baselineAcc: baseline.rounds[baseline.rounds.length - 1].metrics.testAcc };
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
