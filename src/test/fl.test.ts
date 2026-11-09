import { describe, expect, it } from 'vitest';
import { generateFederatedData, DEFAULT_DATA_CONFIG, clientSizes } from '../lib/fl/data';
import { runFedAvg, weightedAverage, selectClients, numSelected, dpFedAccounting, runCentralized } from '../lib/fl/fedavg';
import { estimateCommunication } from '../lib/fl/communication';
import { norm2, sub } from '../lib/vec';
import { combinedCompare, dpUtilitySweep } from '../lib/tasks';

const fed = { rounds: 10, localEpochs: 2, localLr: 0.3, batchSize: 16, participation: 1, seed: 3 };

describe('Agregación FedAvg', () => {
  it('calcula Σ (n_k/N) w_k', () => {
    const r = weightedAverage([[1, 0], [0, 1], [2, 2]], [10, 30, 60]);
    expect(r.N).toBe(100);
    expect(r.weights).toEqual([0.1, 0.3, 0.6]);
    expect(r.params[0]).toBeCloseTo(0.1 + 1.2);
    expect(r.params[1]).toBeCloseTo(0.3 + 1.2);
  });
  it('con pesos iguales es la media simple', () => {
    const r = weightedAverage([[2], [4]], [5, 5]);
    expect(r.params[0]).toBe(3);
  });
  it('falla con entradas inválidas', () => {
    expect(() => weightedAverage([], [])).toThrow();
    expect(() => weightedAverage([[1]], [0])).toThrow();
  });
  it('la ronda completa usa exactamente la media ponderada de modelos locales', () => {
    const data = generateFederatedData({ ...DEFAULT_DATA_CONFIG, sizeSkew: 0.7 });
    const res = runFedAvg(data, { ...fed, rounds: 1 });
    const rt = res.rounds[0];
    const expected = weightedAverage(rt.updates.map((u) => u.endParams), rt.updates.map((u) => u.nSamples));
    rt.globalAfter.forEach((v, j) => expect(v).toBeCloseTo(expected.params[j], 12));
    expect(rt.N).toBe(rt.updates.reduce((s, u) => s + u.nSamples, 0));
  });
});

describe('Selección de clientes', () => {
  it('selecciona round(p·K) clientes, al menos 1', () => {
    expect(numSelected(10, 0.3)).toBe(3);
    expect(numSelected(3, 0.1)).toBe(1);
    expect(selectClients(10, 0.5, 1, 1)).toHaveLength(5);
  });
  it('es reproducible', () => expect(selectClients(10, 0.5, 9, 4)).toEqual(selectClients(10, 0.5, 9, 4)));
});

describe('Simulación federada', () => {
  it('genera datos reproducibles', () => {
    const a = generateFederatedData(DEFAULT_DATA_CONFIG);
    const b = generateFederatedData(DEFAULT_DATA_CONFIG);
    expect(a.clients[0].train).toEqual(b.clients[0].train);
  });
  it('los clientes non-IID tienen proporciones de clase distintas', () => {
    const d = generateFederatedData({ ...DEFAULT_DATA_CONFIG, mode: 'non-iid', classImbalance: 1, samplesPerClient: 600 });
    expect(d.clients[0].positiveRate).toBeLessThan(0.2);
    expect(d.clients[2].positiveRate).toBeGreaterThan(0.8);
  });
  it('la asimetría de tamaños produce clientes de distinto tamaño', () => {
    const s = clientSizes({ ...DEFAULT_DATA_CONFIG, sizeSkew: 0.8 });
    expect(s[0]).toBeGreaterThan(s[2]);
  });
  it('FedAvg mejora la precisión y es reproducible', () => {
    const data = generateFederatedData(DEFAULT_DATA_CONFIG);
    const a = runFedAvg(data, fed);
    const b = runFedAvg(data, fed);
    expect(a.finalParams).toEqual(b.finalParams);
    expect(a.rounds[a.rounds.length - 1].metrics.testAcc).toBeGreaterThan(a.initMetrics.testAcc);
    expect(a.rounds[a.rounds.length - 1].metrics.testAcc).toBeGreaterThan(0.85);
  });
  it('rechaza configuraciones inválidas', () => {
    const data = generateFederatedData(DEFAULT_DATA_CONFIG);
    expect(() => runFedAvg(data, { ...fed, participation: 0 })).toThrow();
    expect(() => runFedAvg(data, { ...fed, rounds: 0 })).toThrow();
    expect(() => generateFederatedData({ ...DEFAULT_DATA_CONFIG, numClients: 11 })).toThrow();
  });
  it('centralizado aprende', () => {
    const data = generateFederatedData(DEFAULT_DATA_CONFIG);
    const c = runCentralized(data, 10, 0.3, 16, 1);
    expect(c.history[c.history.length - 1].testAcc).toBeGreaterThan(0.85);
  });
});

describe('DP-FedAvg', () => {
  const data = generateFederatedData(DEFAULT_DATA_CONFIG);
  it('recorta cada actualización a norma ≤ C', () => {
    const res = runFedAvg(data, { ...fed, dp: { clipNorm: 0.05, noiseMultiplier: 1 } });
    for (const rt of res.rounds) for (const u of rt.updates) expect(norm2(u.clippedDelta!)).toBeLessThanOrEqual(0.05 + 1e-12);
  });
  it('con σ = 0 el nuevo modelo es w + media de Δ recortados', () => {
    const res = runFedAvg(data, { ...fed, rounds: 1, dp: { clipNorm: 0.1, noiseMultiplier: 0 } });
    const rt = res.rounds[0];
    const step = sub(rt.globalAfter, rt.globalBefore);
    const m = rt.updates.length;
    step.forEach((v, j) => expect(v).toBeCloseTo(rt.updates.reduce((s, u) => s + u.clippedDelta![j], 0) / m, 12));
  });
  it('solo calcula ε con participación total y σ > 0', () => {
    expect(dpFedAccounting({ ...fed, dp: { clipNorm: 1, noiseMultiplier: 1 } }, 3).status).toBe('computed');
    expect(dpFedAccounting({ ...fed, participation: 0.5, dp: { clipNorm: 1, noiseMultiplier: 1 } }, 4).status).toBe('not-computed');
    expect(dpFedAccounting({ ...fed, dp: null }, 3).status).toBe('not-computed');
  });
});

describe('Comunicación', () => {
  it('calcula bytes por ronda y totales', () => {
    const c = estimateCommunication({ numParams: 3, numClients: 10, participation: 0.5, rounds: 20 });
    expect(c.clientsPerRound).toBe(5);
    expect(c.perRound).toBe(2 * 5 * 3 * 4);
    expect(c.total).toBe(20 * 120);
  });
  it('coincide con la contabilidad de la simulación', () => {
    const data = generateFederatedData(DEFAULT_DATA_CONFIG);
    const res = runFedAvg(data, fed);
    const c = estimateCommunication({ numParams: 3, numClients: 3, participation: 1, rounds: fed.rounds });
    expect(res.totalBytes).toBe(c.total);
  });
});

describe('Tareas', () => {
  it('el barrido de utilidad muestra error decreciente con ε', () => {
    const rows = dpUtilitySweep({ epsilons: [0.1, 1, 10], sensitivity: 1, trueValue: 50, reps: 3000, seed: 1 });
    expect(rows[0].mae).toBeGreaterThan(rows[1].mae);
    expect(rows[1].mae).toBeGreaterThan(rows[2].mae);
  });
  it('la comparación combinada es reproducible', () => {
    const input = { data: DEFAULT_DATA_CONFIG, fed, dp: { clipNorm: 0.5, noiseMultiplier: 1 } };
    expect(combinedCompare(input).dpfed.finalAcc).toBe(combinedCompare(input).dpfed.finalAcc);
  });
});
