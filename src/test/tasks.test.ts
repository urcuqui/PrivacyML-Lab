import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA_CONFIG } from '../lib/fl/data';
import { iidCompare, commGrid, dpflSweep } from '../lib/tasks';
import { buildReport, runsToJson } from '../lib/report';
import type { ExperimentRun } from '../lib/runs';

const fed = { rounds: 6, localEpochs: 1, localLr: 0.3, batchSize: 16, participation: 1, seed: 5 };

describe('Reproducibilidad de las tareas', () => {
  it('iidCompare devuelve resultados idénticos con la misma semilla', () => {
    const input = { data: DEFAULT_DATA_CONFIG, fed, repeats: 2 };
    const a = iidCompare(input);
    const b = iidCompare(input);
    expect(a).toEqual(b);
    expect(a.map((m) => m.mode)).toEqual(['iid', 'non-iid']);
    expect(a[0].perRound).toHaveLength(fed.rounds + 1);
  });
  it('commGrid encuentra el objetivo y cuenta bytes coherentes', () => {
    const cells = commGrid({ data: DEFAULT_DATA_CONFIG, fed: { ...fed, rounds: 10 }, localEpochsList: [1, 3], participationList: [1], targetAcc: 0.8 });
    expect(cells).toHaveLength(2);
    for (const c of cells) {
      if (c.roundsToTarget !== null) expect(c.bytesToTarget).toBe(c.roundsToTarget * 2 * 3 * 3 * 4);
    }
    // más épocas locales ⇒ más evaluaciones de gradiente totales
    expect(cells[1].totalGradEvals).toBeGreaterThan(cells[0].totalGradEvals);
  });
  it('dpflSweep solo informa ε cuando la participación es total', () => {
    const full = dpflSweep({ data: DEFAULT_DATA_CONFIG, fed, noiseMultipliers: [0, 1], clipNorms: [0.5], repeats: 1, delta: 1e-3 });
    expect(full.rows[0].epsilon).toBeNull(); // σ = 0
    expect(full.rows[1].epsilon).toBeGreaterThan(0);
    const partial = dpflSweep({ data: { ...DEFAULT_DATA_CONFIG, numClients: 4 }, fed: { ...fed, participation: 0.5 }, noiseMultipliers: [1], clipNorms: [0.5], repeats: 1, delta: 1e-3 });
    expect(partial.rows[0].epsilon).toBeNull();
  });
});

describe('Exportación', () => {
  const run: ExperimentRun = {
    id: 'r1',
    experimentId: 'dp2',
    experimentTitle: 'Mecanismo de Laplace',
    name: 'Prueba',
    createdAt: 0,
    seed: 42,
    params: { 'ε': 1 },
    results: { 'Error absoluto': 0.5 },
    assumptions: ['Sensibilidad 1'],
    limitations: ['PRNG no seguro'],
    privacyGuarantee: null,
    saved: true,
    notes: 'Mi observación',
  };
  it('el informe incluye todos los apartados requeridos', () => {
    const md = buildReport([run]);
    for (const s of ['Prueba', 'Semilla aleatoria', 'Configuración del experimento', 'Resultados', 'Supuestos matemáticos', 'Modelo de privacidad', 'Limitaciones', 'Observaciones del estudiante', 'Mi observación']) {
      expect(md).toContain(s);
    }
  });
  it('el JSON es válido y contiene las ejecuciones', () => {
    const parsed = JSON.parse(runsToJson([run]));
    expect(parsed.runs[0].id).toBe('r1');
  });
});
