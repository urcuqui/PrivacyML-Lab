import { describe, expect, it } from 'vitest';
import { createSeededRng, deriveSeed } from '../lib/rng/rng';
import { mean, variance, quantile } from '../lib/stats';

describe('RNG con semilla', () => {
  it('es reproducible con la misma semilla', () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('produce secuencias distintas con semillas distintas', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const sa = Array.from({ length: 10 }, () => a.next());
    const sb = Array.from({ length: 10 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });
  it('genera uniformes en [0,1) con media ≈ 0.5', () => {
    const r = createSeededRng(7);
    const xs = Array.from({ length: 50000 }, () => r.next());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(mean(xs)).toBeCloseTo(0.5, 2);
  });
  it('genera normales con media y varianza correctas', () => {
    const r = createSeededRng(11);
    const xs = Array.from({ length: 50000 }, () => r.normal(2, 3));
    expect(mean(xs)).toBeCloseTo(2, 1);
    expect(Math.sqrt(variance(xs))).toBeCloseTo(3, 1);
  });
  it('deriveSeed es determinista y sensible a las etiquetas', () => {
    expect(deriveSeed(42, 'a', 1)).toBe(deriveSeed(42, 'a', 1));
    expect(deriveSeed(42, 'a', 1)).not.toBe(deriveSeed(42, 'a', 2));
  });
});

describe('Muestreo de Laplace', () => {
  const b = 2;
  const r = createSeededRng(2024);
  const xs = Array.from({ length: 100000 }, () => r.laplace(b));
  it('tiene media ≈ 0', () => expect(mean(xs)).toBeCloseTo(0, 1));
  it('tiene varianza ≈ 2b²', () => expect(variance(xs) / (2 * b * b)).toBeCloseTo(1, 1));
  it('tiene E|X| ≈ b', () => expect(mean(xs.map(Math.abs)) / b).toBeCloseTo(1, 1));
  it('tiene cuantiles correctos (mediana 0, q75 = b·ln2)', () => {
    expect(quantile(xs, 0.5)).toBeCloseTo(0, 1);
    expect(quantile(xs, 0.75) / (b * Math.LN2)).toBeCloseTo(1, 1);
  });
  it('rechaza escalas no positivas', () => {
    expect(() => r.laplace(0)).toThrow();
    expect(() => r.laplace(-1)).toThrow();
  });
});
