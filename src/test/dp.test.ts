import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../lib/rng/rng';
import { laplaceScale, laplaceMechanism, simulateLaplace, laplacePdf, laplaceCdf, laplacePrivacyLoss } from '../lib/dp/laplace';
import { boundedMeanSensitivity, boundedSumSensitivity, countSensitivity, clampedMean } from '../lib/dp/sensitivity';
import { checkSpend, spend, totalSpent, remaining, repeatedReleaseExperiment, type BudgetLedger } from '../lib/dp/composition';
import { gaussianCompositionEpsilon } from '../lib/dp/accountant';
import { std } from '../lib/stats';

describe('Mecanismo de Laplace', () => {
  it('escala b = Δ/ε', () => {
    expect(laplaceScale(1, 0.5)).toBe(2);
    expect(laplaceScale(1, 10)).toBeCloseTo(0.1);
    expect(laplaceScale(3, 1)).toBe(3);
  });
  it('disminuir ε aumenta la escala de ruido', () => {
    const eps = [10, 5, 2, 1, 0.5, 0.1];
    const scales = eps.map((e) => laplaceScale(1, e));
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThan(scales[i - 1]);
  });
  it('rechaza ε y Δ inválidos', () => {
    expect(() => laplaceScale(1, 0)).toThrow();
    expect(() => laplaceScale(1, -1)).toThrow();
    expect(() => laplaceScale(0, 1)).toThrow();
    expect(() => laplaceScale(1, Infinity)).toThrow();
  });
  it('released = trueValue + noise', () => {
    const r = laplaceMechanism(30, 1, 1, createSeededRng(1));
    expect(r.released).toBeCloseTo(r.trueValue + r.noise, 12);
    expect(r.absError).toBeCloseTo(Math.abs(r.noise), 12);
  });
  it('el error absoluto medio empírico converge a b', () => {
    const s = simulateLaplace(50, 1, 0.5, 40000, createSeededRng(9));
    expect(s.meanAbsError / s.theoreticalMAE).toBeCloseTo(1, 1);
    expect(s.stdRelease / s.theoreticalStd).toBeCloseTo(1, 1);
  });
  it('es reproducible con la misma semilla', () => {
    const a = simulateLaplace(10, 1, 1, 50, createSeededRng(5));
    const b = simulateLaplace(10, 1, 1, 50, createSeededRng(5));
    expect(a.releases).toEqual(b.releases);
  });
  it('la pdf integra a 1 y la cdf es coherente', () => {
    let s = 0;
    const h = 0.01;
    for (let x = -50; x < 50; x += h) s += laplacePdf(x, 0, 1) * h;
    expect(s).toBeCloseTo(1, 2);
    expect(laplaceCdf(0, 0, 1)).toBeCloseTo(0.5);
  });
  it('la pérdida de privacidad está acotada por ε para vecinos con Δ=1', () => {
    const eps = 0.7;
    const b = 1 / eps;
    for (let x = -20; x <= 20; x += 0.37) {
      expect(Math.abs(laplacePrivacyLoss(x, 10, 9, b))).toBeLessThanOrEqual(eps + 1e-12);
    }
  });
});

describe('Sensibilidad', () => {
  it('conteo: Δ = 1', () => expect(countSensitivity().value).toBe(1));
  it('media acotada: Δ = (U−L)/n', () => {
    expect(boundedMeanSensitivity(18, 90, 100).value).toBeCloseTo(0.72);
    expect(() => boundedMeanSensitivity(5, 5, 10)).toThrow();
    expect(() => boundedMeanSensitivity(0, 1, 0)).toThrow();
  });
  it('la media acotada cambia como mucho Δ al reemplazar un valor', () => {
    const L = 0, U = 100, n = 20;
    const r = createSeededRng(3);
    const D = Array.from({ length: n }, () => r.uniform(-50, 150));
    const delta = boundedMeanSensitivity(L, U, n).value;
    for (let t = 0; t < 200; t++) {
      const Dp = D.slice();
      Dp[r.int(n)] = r.uniform(-1000, 1000);
      expect(Math.abs(clampedMean(D, L, U) - clampedMean(Dp, L, U))).toBeLessThanOrEqual(delta + 1e-9);
    }
  });
  it('suma acotada (añadir/eliminar): Δ = max(|L|,|U|)', () => {
    expect(boundedSumSensitivity(-3, 2).value).toBe(3);
  });
});

describe('Composición secuencial', () => {
  const base: BudgetLedger = { limit: 2, entries: [] };
  const entry = (eps: number, id: string) => ({ id, label: id, epsilon: eps, timestamp: 0 });
  it('suma los ε de las consultas', () => {
    let l = spend(base, entry(0.5, 'A'));
    l = spend(l, entry(0.5, 'B'));
    l = spend(l, entry(1.0, 'C'));
    expect(totalSpent(l)).toBeCloseTo(2.0);
    expect(remaining(l)).toBeCloseTo(0);
  });
  it('rechaza consultas que superan el límite', () => {
    const l = spend(base, entry(1.5, 'A'));
    expect(checkSpend(l, 0.6).ok).toBe(false);
    expect(() => spend(l, entry(0.6, 'B'))).toThrow();
    expect(checkSpend(l, 0.5).ok).toBe(true);
  });
  it('promediar k publicaciones reduce el error (y cuesta k·ε)', () => {
    const r = repeatedReleaseExperiment(100, 1, 0.5, 10, 4000, createSeededRng(8));
    expect(r.totalEpsilonAveraged).toBeCloseTo(5);
    expect(std(r.averaged)).toBeLessThan(std(r.single) / 2);
  });
});

describe('Contador RDP gaussiano', () => {
  it('coincide con la fórmula cerrada en el α óptimo', () => {
    const sigma = 2, T = 10, delta = 1e-5;
    const r = gaussianCompositionEpsilon({ noiseMultiplier: sigma, steps: T, delta });
    const aStar = 1 + Math.sqrt((2 * sigma * sigma * Math.log(1 / delta)) / T);
    const closed = (T * aStar) / (2 * sigma * sigma) + Math.log(1 / delta) / (aStar - 1);
    expect(r.epsilon).toBeCloseTo(closed, 6);
  });
  it('ε crece con los pasos y decrece con σ', () => {
    const e = (s: number, T: number) => gaussianCompositionEpsilon({ noiseMultiplier: s, steps: T, delta: 1e-5 }).epsilon;
    expect(e(1, 20)).toBeGreaterThan(e(1, 10));
    expect(e(2, 10)).toBeLessThan(e(1, 10));
  });
  it('valida entradas', () => {
    expect(() => gaussianCompositionEpsilon({ noiseMultiplier: 0, steps: 1, delta: 1e-5 })).toThrow();
    expect(() => gaussianCompositionEpsilon({ noiseMultiplier: 1, steps: 1, delta: 0 })).toThrow();
  });
});
