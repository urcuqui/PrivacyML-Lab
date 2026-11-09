export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
export function mean(xs: readonly number[]): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}
export function variance(xs: readonly number[], sample = true): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - (sample ? 1 : 0));
}
export function std(xs: readonly number[], sample = true): number {
  return Math.sqrt(variance(xs, sample));
}
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
/** Semiancho del intervalo de confianza al 95% para la media (aprox. normal). */
export function ci95(xs: readonly number[]): number {
  return xs.length > 1 ? (1.96 * std(xs)) / Math.sqrt(xs.length) : 0;
}
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

export interface HistogramBin {
  x0: number;
  x1: number;
  mid: number;
  count: number;
  density: number;
}
export function histogram(xs: readonly number[], bins: number, range?: [number, number]): HistogramBin[] {
  if (!xs.length || bins < 1) return [];
  const lo = range ? range[0] : Math.min(...xs);
  let hi = range ? range[1] : Math.max(...xs);
  if (hi === lo) hi = lo + 1;
  const w = (hi - lo) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    x0: lo + i * w,
    x1: lo + (i + 1) * w,
    mid: lo + (i + 0.5) * w,
    count: 0,
    density: 0,
  }));
  for (const x of xs) {
    if (x < lo || x > hi) continue;
    const i = Math.min(bins - 1, Math.floor((x - lo) / w));
    out[i].count++;
  }
  for (const b of out) b.density = b.count / (xs.length * w);
  return out;
}

export function round(x: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
export function fmt(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toLocaleString('es-ES', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
