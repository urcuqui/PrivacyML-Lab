import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../lib/rng/rng';
import { clipL2, norm2, sub } from '../lib/vec';
import { clippedSumSensitivityMultiple, dpFedAvgSpec, dpsgdSpec, GENERAL_LIMITATIONS } from '../lib/privacy/model';
import { boundedMeanSensitivityAddRemove, clippedSumL2Sensitivity, countSensitivity, proportionSensitivity } from '../lib/dp/sensitivity';
import { gaussianCompositionEpsilon, gaussianExactDelta, gaussianExactEpsilon } from '../lib/dp/accountant';
import { createBatchScheduler, dpsgdAccounting, maxParticipationsPerRecord, trainLogistic } from '../lib/dp/dpsgd';
import { generateBlobs, splitTrainTest } from '../lib/ml/logistic';
import { DEFAULT_DATA_CONFIG, generateFederatedData, REFERENCE_SEED } from '../lib/fl/data';
import { dpFedAccounting, runFedAvg, weightedAverage, type FedAvgConfig } from '../lib/fl/fedavg';
import { combinedCompare, dpflSweep, iidCompare } from '../lib/tasks';
import { buildReport, runsToJson } from '../lib/report';
import { privacyRecord, type ExperimentRun } from '../lib/runs';
import { normalCdf } from '../lib/stats';

const fed: FedAvgConfig = { rounds: 8, localEpochs: 2, localLr: 0.3, batchSize: 16, participation: 1, seed: 11 };

describe('Vecindad y sensibilidad', () => {
  it('suma recortada: C con añadir/eliminar y 2C con reemplazo', () => {
    expect(clippedSumSensitivityMultiple('add-remove')).toBe(1);
    expect(clippedSumSensitivityMultiple('replace')).toBe(2);
    expect(clippedSumL2Sensitivity(0.5, 'add-remove').value).toBe(0.5);
    expect(clippedSumL2Sensitivity(0.5, 'replace').value).toBe(1);
    expect(() => clippedSumL2Sensitivity(0, 'replace')).toThrow();
  });
  it('la cota 2C bajo reemplazo es alcanzable y nunca se supera', () => {
    const C = 1;
    const rng = createSeededRng(3);
    let maxRep = 0;
    let maxAdd = 0;
    for (let t = 0; t < 2000; t++) {
      const v = clipL2([rng.normal(0, 3), rng.normal(0, 3)], C);
      const w = clipL2([rng.normal(0, 3), rng.normal(0, 3)], C);
      maxRep = Math.max(maxRep, norm2(sub(v, w)));
      maxAdd = Math.max(maxAdd, norm2(v));
    }
    expect(maxRep).toBeLessThanOrEqual(2 * C + 1e-12);
    expect(maxAdd).toBeLessThanOrEqual(C + 1e-12);
    // v y −v con ‖v‖ = C alcanzan exactamente 2C
    expect(norm2(sub([1, 0], [-1, 0]))).toBe(2 * C);
    expect(maxRep).toBeGreaterThan(1.9 * C);
  });
  it('conteo Δ₁ = 1 en ambas vecindades; proporción solo con reemplazo', () => {
    expect(countSensitivity('add-remove').value).toBe(1);
    expect(countSensitivity('replace').value).toBe(1);
    expect(proportionSensitivity(50).value).toBeCloseTo(0.02);
    expect(() => boundedMeanSensitivityAddRemove()).toThrow(/suma acotada y el conteo/);
  });
});

describe('Contador RDP gaussiano', () => {
  it('reemplazo (k = 2) equivale a usar σ/2 con k = 1', () => {
    const a = gaussianCompositionEpsilon({ noiseMultiplier: 2, steps: 10, delta: 1e-5, sensitivityMultiple: 2 });
    const b = gaussianCompositionEpsilon({ noiseMultiplier: 1, steps: 10, delta: 1e-5 });
    expect(a.epsilon).toBeCloseTo(b.epsilon, 10);
    expect(a.details.effectiveNoiseMultiplier).toBe(1);
  });
  it('ε crece con k y con T, y decrece con σ', () => {
    const e = (s: number, T: number, k = 1) => gaussianCompositionEpsilon({ noiseMultiplier: s, steps: T, delta: 1e-5, sensitivityMultiple: k }).epsilon;
    expect(e(1, 10, 2)).toBeGreaterThan(e(1, 10, 1));
    expect(e(1, 20)).toBeGreaterThan(e(1, 10));
    expect(e(4, 10)).toBeLessThan(e(1, 10));
  });
  it('valor de referencia derivado a mano: σ = 1, T = 1, δ = 1e−5', () => {
    // α* = 1 + √(2·ln 1e5) ; ε = α*/2 + ln(1e5)/(α* − 1)
    const L = Math.log(1e5);
    const a = 1 + Math.sqrt(2 * L);
    expect(gaussianCompositionEpsilon({ noiseMultiplier: 1, steps: 1, delta: 1e-5 }).epsilon).toBeCloseTo(a / 2 + L / (a - 1), 6);
  });
  it('la curva exacta μ-GDP tiene valores conocidos', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    // ε = 0: δ = Φ(μ/2) − Φ(−μ/2)
    expect(gaussianExactDelta(0, 1)).toBeCloseTo(normalCdf(0.5) - normalCdf(-0.5), 7);
  });
  it('la cota RDP es CORRECTA (conservadora) frente a la curva exacta y no absurdamente holgada', () => {
    for (const sigma of [0.7, 1, 2, 4]) {
      for (const T of [1, 10, 100]) {
        for (const k of [1, 2]) {
          for (const delta of [1e-3, 1e-5]) {
            const r = gaussianCompositionEpsilon({ noiseMultiplier: sigma, steps: T, delta, sensitivityMultiple: k });
            const mu = r.details.gdpMu;
            expect(mu).toBeCloseTo(Math.sqrt(T) / (sigma / k), 10);
            // Solidez: el δ exacto al ε de RDP no supera el δ objetivo.
            expect(gaussianExactDelta(r.epsilon, mu)).toBeLessThanOrEqual(delta * (1 + 1e-4));
            // Holgura razonable: RDP no más de ~2,5 veces el ε exacto.
            const exact = gaussianExactEpsilon(mu, delta);
            expect(r.epsilon).toBeGreaterThanOrEqual(exact - 1e-6);
            expect(r.epsilon / exact).toBeLessThan(2.5);
          }
        }
      }
    }
  });
});

describe('DP-SGD: contabilidad según vecindad y muestreo', () => {
  const n = 300;
  const base = { learningRate: 0.5, batchSize: 30, steps: 50, clipNorm: 1, noiseMultiplier: 1.5, seed: 1, delta: 1e-5 };
  it('añadir/eliminar + lote completo: T composiciones con Δ = C', () => {
    const r = dpsgdAccounting({ ...base, batchSize: n, adjacency: 'add-remove' }, n);
    expect(r.status).toBe('computed');
    if (r.status === 'computed') {
      expect(r.details.compositions).toBe(50);
      expect(r.details.sensitivityMultiple).toBe(1);
    }
  });
  it('añadir/eliminar + mini-lotes: No calculado con motivo', () => {
    const r = dpsgdAccounting({ ...base, adjacency: 'add-remove' }, n);
    expect(r.status).toBe('not-computed');
    if (r.status === 'not-computed') expect(r.reason).toMatch(/submuestreo/);
  });
  it('reemplazo + lote completo: T composiciones con Δ = 2C', () => {
    const r = dpsgdAccounting({ ...base, batchSize: n, adjacency: 'replace' }, n);
    expect(r.status === 'computed' && r.details.compositions === 50 && r.details.sensitivityMultiple === 2).toBe(true);
  });
  it('reemplazo + mini-lotes: ⌈T/⌊n/B⌋⌉ participaciones con Δ = 2C', () => {
    const r = dpsgdAccounting({ ...base, adjacency: 'replace' }, n);
    expect(r.status).toBe('computed');
    if (r.status === 'computed') expect(r.details.compositions).toBe(Math.ceil(50 / 10));
  });
  it('σ = 0 nunca produce ε', () => {
    for (const adjacency of ['add-remove', 'replace'] as const) {
      expect(dpsgdAccounting({ ...base, batchSize: n, noiseMultiplier: 0, adjacency }, n).status).toBe('not-computed');
    }
  });
  it('el calendario real de lotes respeta la cota de participaciones por registro', () => {
    for (const [nn, B, T] of [
      [100, 7, 200],
      [50, 50, 30],
      [64, 16, 37],
      [10, 3, 100],
    ] as const) {
      const sch = createBatchScheduler(nn, B, 9);
      const counts = new Array(nn).fill(0);
      for (let t = 0; t < T; t++) {
        const b = sch.next();
        expect(b).toHaveLength(B);
        expect(new Set(b).size).toBe(B);
        b.forEach((i) => counts[i]++);
      }
      expect(Math.max(...counts)).toBeLessThanOrEqual(maxParticipationsPerRecord(nn, B, T));
    }
  });
  it('el entrenamiento usa exactamente el calendario de lotes documentado', () => {
    const rng = createSeededRng(2);
    const { train, test } = splitTrainTest(generateBlobs(120, rng), 0.25, rng);
    const res = trainLogistic('dpsgd', train, test, { ...base, batchSize: 10, steps: 4 }, { traceFirst: 4 });
    const sch = createBatchScheduler(train.length, 10, base.seed);
    res.traces.forEach((t) => expect(t.perExample.map((p) => p.index)).toEqual(sch.next()));
  });
  it('el ruido de DP-SGD tiene desviación σ·C independientemente de la vecindad', () => {
    const rng = createSeededRng(5);
    const { train, test } = splitTrainTest(generateBlobs(200, rng), 0.25, rng);
    for (const adjacency of ['add-remove', 'replace'] as const) {
      const res = trainLogistic('dpsgd', train, test, { ...base, steps: 400, clipNorm: 0.4, noiseMultiplier: 2.5, adjacency }, { traceFirst: 400 });
      const z = res.traces.flatMap((t) => t.noise!);
      const sd = Math.sqrt(z.reduce((s, x) => s + x * x, 0) / z.length);
      expect(sd / (2.5 * 0.4)).toBeCloseTo(1, 1);
    }
  });
});

describe('DP-FedAvg: calibración y contabilidad', () => {
  const data = generateFederatedData({ ...DEFAULT_DATA_CONFIG, numClients: 5 });
  it('w_{t+1} = w_t + (Σ clip(Δ_k) + ruido)/m̄ con ruido de desviación σC', () => {
    const res = runFedAvg(data, { ...fed, rounds: 400, localEpochs: 1, dp: { clipNorm: 0.2, noiseMultiplier: 1.5 } });
    const noise: number[] = [];
    for (const rt of res.rounds) {
      const mBar = rt.publicDenominator!;
      expect(mBar).toBe(5);
      rt.globalAfter.forEach((v, j) => {
        const sum = rt.updates.reduce((s, u) => s + u.clippedDelta![j], 0);
        expect(v).toBeCloseTo(rt.globalBefore[j] + (sum + rt.noise![j]) / mBar, 12);
      });
      noise.push(...rt.noise!);
    }
    const sd = Math.sqrt(noise.reduce((s, x) => s + x * x, 0) / noise.length);
    expect(noise.length).toBe(1200);
    expect(sd / (1.5 * 0.2)).toBeGreaterThan(0.93);
    expect(sd / (1.5 * 0.2)).toBeLessThan(1.07);
  });
  it('el denominador es la constante pública m̄ incluso con participación parcial', () => {
    const res = runFedAvg(data, { ...fed, participation: 0.6, dp: { clipNorm: 0.2, noiseMultiplier: 1 } });
    res.rounds.forEach((rt) => expect(rt.publicDenominator).toBe(3));
  });
  it('matriz de contabilidad a nivel de cliente', () => {
    const dp = { clipNorm: 1, noiseMultiplier: 1 };
    const addFull = dpFedAccounting({ ...fed, dp: { ...dp, adjacency: 'add-remove' } }, 5);
    expect(addFull.status === 'computed' && addFull.details.sensitivityMultiple === 1 && addFull.details.compositions === fed.rounds).toBe(true);
    expect(dpFedAccounting({ ...fed, participation: 0.6, dp: { ...dp, adjacency: 'add-remove' } }, 5).status).toBe('not-computed');
    const repPartial = dpFedAccounting({ ...fed, participation: 0.6, dp: { ...dp, adjacency: 'replace' } }, 5);
    expect(repPartial.status === 'computed' && repPartial.details.sensitivityMultiple === 2 && repPartial.details.compositions === fed.rounds).toBe(true);
    expect(dpFedAccounting({ ...fed, dp: { ...dp, noiseMultiplier: 0 } }, 5).status).toBe('not-computed');
    expect(dpFedAccounting({ ...fed, clipNorm: 1 }, 5).status).toBe('not-computed');
    if (addFull.status === 'computed') expect(addFull.assumptions.join(' ')).toMatch(/NO frente al servidor/);
  });
  it('DP-FedAvg no admite ponderación n_k/N', () => {
    expect(() => runFedAvg(data, { ...fed, aggregation: 'weighted', dp: { clipNorm: 1, noiseMultiplier: 1 } })).toThrow(/uniforme/);
  });
});

describe('Ponderación, recorte y ruido por separado', () => {
  const data = generateFederatedData({ ...DEFAULT_DATA_CONFIG, sizeSkew: 0.8 });
  it('agregación uniforme: w + media de Δ_k', () => {
    const rt = runFedAvg(data, { ...fed, rounds: 1, aggregation: 'uniform' }).rounds[0];
    rt.globalAfter.forEach((v, j) => expect(v).toBeCloseTo(rt.globalBefore[j] + rt.updates.reduce((s, u) => s + u.delta[j], 0) / rt.updates.length, 12));
    rt.weights.forEach((w) => expect(w.weight).toBeCloseTo(1 / rt.updates.length));
  });
  it('agregación ponderada por defecto = media ponderada de modelos', () => {
    const rt = runFedAvg(data, { ...fed, rounds: 1 }).rounds[0];
    const exp = weightedAverage(rt.updates.map((u) => u.endParams), rt.updates.map((u) => u.nSamples));
    rt.globalAfter.forEach((v, j) => expect(v).toBeCloseTo(exp.params[j], 12));
    expect(new Set(rt.weights.map((w) => w.weight.toFixed(6))).size).toBeGreaterThan(1);
  });
  it('recorte sin ruido: Δ recortados, sin ruido y SIN garantía DP', () => {
    const res = runFedAvg(data, { ...fed, aggregation: 'uniform', clipNorm: 0.05 });
    res.rounds.forEach((rt) => {
      expect(rt.noise).toBeNull();
      rt.updates.forEach((u) => expect(norm2(u.clippedDelta!)).toBeLessThanOrEqual(0.05 + 1e-12));
    });
    expect(res.accounting.status).toBe('not-computed');
  });
  it('DP con σ = 0 coincide exactamente con el recorte sin ruido', () => {
    const a = runFedAvg(data, { ...fed, aggregation: 'uniform', clipNorm: 0.3 });
    const b = runFedAvg(data, { ...fed, dp: { clipNorm: 0.3, noiseMultiplier: 0 } });
    a.finalParams.forEach((v, j) => expect(b.finalParams[j]).toBeCloseTo(v, 12));
  });
  it('cambiar la semilla del ruido no cambia la selección ni las actualizaciones de la primera ronda', () => {
    const cfg = { ...fed, participation: 0.67, dp: { clipNorm: 0.3, noiseMultiplier: 1 } };
    const a = runFedAvg(data, { ...cfg, noiseSeed: 1 });
    const b = runFedAvg(data, { ...cfg, noiseSeed: 2 });
    expect(a.rounds.map((r) => r.selected)).toEqual(b.rounds.map((r) => r.selected));
    expect(a.rounds[0].updates.map((u) => u.delta)).toEqual(b.rounds[0].updates.map((u) => u.delta));
    expect(a.rounds[0].noise).not.toEqual(b.rounds[0].noise);
  });
  it('la comparación combinada es reproducible y su descomposición suma el total', () => {
    const input = { data: DEFAULT_DATA_CONFIG, fed, dp: { clipNorm: 0.3, noiseMultiplier: 1 }, noiseRepeats: 3 };
    const a = combinedCompare(input);
    expect(combinedCompare(input)).toEqual(a);
    const d = a.decomposition;
    expect(d.weighting + d.clipping + d.noise).toBeCloseTo(d.total, 12);
    expect(a.dpfed.finalAccs).toHaveLength(3);
    expect(a.series[0].fedavg).toBe(a.series[0].uniform);
  });
  it('el barrido solo calcula ε cuando la contabilidad es válida', () => {
    const d4 = { ...DEFAULT_DATA_CONFIG, numClients: 4 };
    const partial = { ...fed, rounds: 4, participation: 0.5 };
    const add = dpflSweep({ data: d4, fed: partial, noiseMultipliers: [0, 1], clipNorms: [0.5], repeats: 2, delta: 1e-3, adjacency: 'add-remove' });
    expect(add.rows.every((r) => r.epsilon === null)).toBe(true);
    const rep = dpflSweep({ data: d4, fed: partial, noiseMultipliers: [0, 1], clipNorms: [0.5], repeats: 2, delta: 1e-3, adjacency: 'replace' });
    expect(rep.rows[0].epsilon).toBeNull();
    expect(rep.rows[1].epsilon).toBeGreaterThan(0);
    expect(rep.uniformAcc).toBeGreaterThan(0);
  });
});

describe('Conjunto de evaluación de referencia común', () => {
  it('es idéntico entre IID y Non-IID, entre semillas de datos y entre números de clientes', () => {
    const a = generateFederatedData({ ...DEFAULT_DATA_CONFIG, mode: 'iid', seed: 1 });
    const b = generateFederatedData({ ...DEFAULT_DATA_CONFIG, mode: 'non-iid', seed: 99, numClients: 6, featureShift: 3 });
    expect(a.referenceTest).toEqual(b.referenceTest);
    expect(a.globalTest).not.toEqual(b.globalTest);
  });
  it('es independiente de los datos de entrenamiento', () => {
    const d = generateFederatedData({ ...DEFAULT_DATA_CONFIG, mode: 'non-iid' });
    const train = new Set(d.clients.flatMap((c) => c.train.map((s) => s.x.join(','))));
    expect(d.referenceTest.some((s) => train.has(s.x.join(',')))).toBe(false);
  });
  it('responde a su propia semilla y tamaño', () => {
    const a = generateFederatedData({ ...DEFAULT_DATA_CONFIG, referenceSeed: REFERENCE_SEED + 1, referenceTestSize: 50 });
    expect(a.referenceTest).toHaveLength(50);
    expect(a.referenceTest).not.toEqual(generateFederatedData({ ...DEFAULT_DATA_CONFIG, referenceTestSize: 50 }).referenceTest);
  });
  it('iidCompare informa la precisión en el escenario y en la referencia', () => {
    const res = iidCompare({ data: DEFAULT_DATA_CONFIG, fed: { ...fed, rounds: 3 }, repeats: 2 });
    for (const m of res) {
      expect(m.finalRefAcc).toHaveLength(2);
      expect(m.perRound[0].refAccMean).toBeGreaterThan(0);
    }
  });
});

describe('Supuestos de privacidad en las exportaciones', () => {
  const baseRun: ExperimentRun = {
    id: 'r',
    experimentId: 'dp5',
    experimentTitle: 'DP-SGD',
    name: 'Run',
    createdAt: 0,
    seed: 1,
    params: {},
    results: {},
    assumptions: [],
    limitations: [],
    privacyGuarantee: null,
    saved: true,
    notes: '',
  };
  it('incluye unidad, vecindad, sensibilidad, C, σ, (ε, δ) y supuestos del contador', () => {
    const acc = dpsgdAccounting({ learningRate: 0.1, batchSize: 100, steps: 10, clipNorm: 0.5, noiseMultiplier: 2, seed: 1, adjacency: 'replace' }, 100);
    const run = { ...baseRun, privacy: privacyRecord(dpsgdSpec('replace'), acc, { clipNorm: 0.5, noiseMultiplier: 2 }) };
    const md = buildReport([run]);
    for (const s of ['Modelo de privacidad', 'Registro (record-level DP)', 'Reemplazar', 'Δ₂ = 2C', 'Norma de recorte C:** 0,5', 'σ:** 2', 'Supuestos del contador', 'NO están cubiertas']) expect(md).toContain(s);
    expect(md).toMatch(/\(ε, δ\) = \([\d,]+, 1e-5\)/);
    expect(JSON.parse(runsToJson([run])).runs[0].privacy.adjacency).toBe('replace');
  });
  it('explica el motivo cuando ε no se calcula', () => {
    const acc = dpFedAccounting({ ...fed, participation: 0.5, dp: { clipNorm: 1, noiseMultiplier: 1 } }, 4);
    const md = buildReport([{ ...baseRun, privacy: privacyRecord(dpFedAvgSpec('add-remove'), acc) }]);
    expect(md).toContain('No calculado. Motivo:');
    expect(md).toContain('Cliente (client-level DP)');
  });
  it('sin mecanismo DP declara que no hay garantía y nunca omite limitaciones', () => {
    const md = buildReport([baseRun]);
    expect(md).toContain('no se establece ninguna garantía formal');
    GENERAL_LIMITATIONS.forEach((l) => expect(md).toContain(l));
    expect(JSON.parse(runsToJson([baseRun])).generalLimitations).toEqual(GENERAL_LIMITATIONS);
  });
});

describe('Formato de exportación', () => {
  it('no redondea δ pequeños a cero', async () => {
    const { fmtVal } = await import('../lib/report');
    expect(fmtVal(1e-5)).toBe('1e-5');
    expect(fmtVal(0.001)).not.toBe('0');
    expect(fmtVal(2.5)).toBe('2,5');
  });
});
