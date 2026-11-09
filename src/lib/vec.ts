export type Vec = number[];
export const zeros = (n: number): Vec => new Array(n).fill(0);
export const add = (a: Vec, b: Vec): Vec => a.map((x, i) => x + b[i]);
export const sub = (a: Vec, b: Vec): Vec => a.map((x, i) => x - b[i]);
export const scale = (a: Vec, s: number): Vec => a.map((x) => x * s);
export const dot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i], 0);
export const norm2 = (a: Vec): number => Math.sqrt(dot(a, a));
/** Recorta el vector a norma L2 ≤ C: v · min(1, C/‖v‖). */
export function clipL2(v: Vec, C: number): Vec {
  if (!(C > 0)) throw new RangeError('La norma de recorte debe ser positiva');
  const n = norm2(v);
  return n <= C ? v.slice() : scale(v, C / n);
}
