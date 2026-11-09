import { generateFederatedData, type FederatedDataConfig } from '@/lib/fl/data';
import { runFedAvg, type FedAvgConfig } from '@/lib/fl/fedavg';

/**
 * Malla de simulaciones FedAvg (épocas locales × participación) que mide cuánta comunicación
 * y cuánto cómputo hacen falta para alcanzar un objetivo. Admite objetivo por pérdida de test
 * (más informativo en este problema sintético, donde la precisión se satura muy pronto) o por precisión.
 */
export type TargetMetric = 'loss' | 'acc';

export interface GridCell {
  localEpochs: number;
  participation: number;
  roundsToTarget: number | null;
  bytesToTarget: number | null;
  gradEvalsToTarget: number | null;
  finalAcc: number;
  finalLoss: number;
}

export function commGridByTarget(input: {
  data: FederatedDataConfig;
  fed: FedAvgConfig;
  localEpochsList: number[];
  participationList: number[];
  metric: TargetMetric;
  target: number;
}): GridCell[] {
  const data = generateFederatedData(input.data);
  const cells: GridCell[] = [];
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
        const ok = input.metric === 'loss' ? rt.metrics.testLoss <= input.target : rt.metrics.testAcc >= input.target;
        if (reached === null && ok) {
          reached = rt.round;
          bytesTo = bytes;
          gradsTo = grads;
        }
      }
      const last = res.rounds[res.rounds.length - 1].metrics;
      cells.push({ localEpochs: E, participation: p, roundsToTarget: reached, bytesToTarget: bytesTo, gradEvalsToTarget: gradsTo, finalAcc: last.testAcc, finalLoss: last.testLoss });
    }
  }
  return cells;
}
