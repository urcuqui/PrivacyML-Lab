import { it } from 'vitest';
import { generateFederatedData, DEFAULT_DATA_CONFIG } from '../lib/fl/data';
import { runFedAvg } from '../lib/fl/fedavg';
it('probe', () => {
  for (const mode of ['iid','non-iid'] as const) {
    const d = generateFederatedData({ ...DEFAULT_DATA_CONFIG, mode });
    const r = runFedAvg(d, { rounds: 15, localEpochs: 1, localLr: 0.1, batchSize: 16, participation: 1, seed: 1 });
    console.log(mode, r.initMetrics.testAcc.toFixed(3), r.rounds.map(x => x.metrics.testAcc.toFixed(3)).join(' '), '| loss', r.rounds.map(x => x.metrics.testLoss.toFixed(3)).join(' '));
  }
});
