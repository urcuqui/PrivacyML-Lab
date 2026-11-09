import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../lib/rng/rng';
import { generateBlobs, perExampleGradient, sigmoid, bceLoss, accuracy, initParams, splitTrainTest } from '../lib/ml/logistic';
import { trainLogistic, dpsgdAccounting } from '../lib/dp/dpsgd';
import { clipL2, norm2 } from '../lib/vec';
import { gradientInversion } from '../lib/fl/leakage';

describe('Regresión logística', () => {
  it('sigmoide es estable y simétrica', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBe(0);
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1);
  });
  it('el gradiente analítico coincide con diferencias finitas', () => {
    const params = [0.3, -0.7, 0.1];
    const s = { x: [1.2, -0.4], y: 1 as const };
    const g = perExampleGradient(params, s);
    const h = 1e-6;
    for (let j = 0; j < 3; j++) {
      const p1 = params.slice(); p1[j] += h;
      const p2 = params.slice(); p2[j] -= h;
      const fd = (bceLoss(p1, [s]) - bceLoss(p2, [s])) / (2 * h);
      expect(g[j]).toBeCloseTo(fd, 5);
    }
  });
});

describe('Recorte L2', () => {
  it('no modifica vectores con norma ≤ C', () => expect(clipL2([0.3, 0.4], 1)).toEqual([0.3, 0.4]));
  it('reduce la norma exactamente a C conservando la dirección', () => {
    const v = clipL2([3, 4], 1);
    expect(norm2(v)).toBeCloseTo(1);
    expect(v[0] / v[1]).toBeCloseTo(0.75);
  });
});

describe('DP-SGD', () => {
  const rng = createSeededRng(1);
  const { train, test } = splitTrainTest(generateBlobs(400, rng), 0.25, rng);
  const cfg = { learningRate: 0.5, batchSize: 32, steps: 150, clipNorm: 1, noiseMultiplier: 1, seed: 7 };
  it('SGD aprende el problema sintético', () => {
    const r = trainLogistic('sgd', train, test, cfg);
    expect(r.history[r.history.length - 1].testAcc).toBeGreaterThan(0.8);
    expect(accuracy(initParams(2), test)).toBeLessThan(0.7);
  });
  it('todos los gradientes recortados tienen norma ≤ C', () => {
    const r = trainLogistic('dpsgd', train, test, { ...cfg, clipNorm: 0.2 }, { traceFirst: 5 });
    for (const t of r.traces) for (const pe of t.perExample) expect(pe.clippedNorm).toBeLessThanOrEqual(0.2 + 1e-9);
  });
  it('el ruido tiene la desviación esperada σ·C', () => {
    const r = trainLogistic('dpsgd', train, test, { ...cfg, steps: 300, noiseMultiplier: 2, clipNorm: 0.5 }, { traceFirst: 300 });
    const noises = r.traces.flatMap((t) => t.noise!);
    const sd = Math.sqrt(noises.reduce((s, z) => s + z * z, 0) / noises.length);
    expect(sd / (2 * 0.5)).toBeCloseTo(1, 1);
  });
  it('es reproducible con la misma semilla', () => {
    const a = trainLogistic('dpsgd', train, test, cfg);
    const b = trainLogistic('dpsgd', train, test, cfg);
    expect(a.params).toEqual(b.params);
  });
  it('no inventa ε con mini-lotes; lo calcula solo con lote completo', () => {
    expect(dpsgdAccounting(cfg, train.length).status).toBe('not-computed');
    expect(dpsgdAccounting({ ...cfg, batchSize: train.length }, train.length).status).toBe('computed');
    expect(dpsgdAccounting({ ...cfg, batchSize: train.length, noiseMultiplier: 0 }, train.length).status).toBe('not-computed');
  });
});

describe('Ilustración de fuga por gradientes', () => {
  it('con un único ejemplo, g_w / g_b recupera x exactamente', () => {
    const s = { x: [1.7, -0.3], y: 0 as const };
    const r = gradientInversion([0.2, 0.5, -0.1], [s]);
    expect(r.estimate![0]).toBeCloseTo(1.7, 10);
    expect(r.estimate![1]).toBeCloseTo(-0.3, 10);
  });
  it('con un lote, el cociente es la media ponderada por residuos', () => {
    const batch = generateBlobs(8, createSeededRng(4));
    const r = gradientInversion([0.1, 0.1, 0], batch);
    expect(r.estimate![0]).toBeCloseTo(r.residualWeightedMean![0], 8);
  });
});
