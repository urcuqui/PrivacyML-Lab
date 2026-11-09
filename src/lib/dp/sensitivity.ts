/**
 * Sensibilidades globales L1 bajo supuestos explícitos.
 * - Vecindad "añadir/eliminar" (unbounded DP): D' = D ± una persona.
 * - Vecindad "reemplazar" (bounded DP): D' = D con una persona sustituida; n es público.
 */
export type Neighbouring = 'add-remove' | 'replace';

export interface SensitivityResult {
  value: number;
  formula: string;
  assumptions: string[];
}

export function countSensitivity(neighbouring: Neighbouring = 'add-remove'): SensitivityResult {
  return {
    value: 1,
    formula: neighbouring === 'add-remove' ? 'Δ = 1 (añadir o eliminar una persona cambia el conteo como mucho en 1)' : 'Δ = 1 (reemplazar una persona cambia el conteo como mucho en 1)',
    assumptions: ['Cada persona aparece como máximo una vez en el conjunto de datos.', 'La consulta cuenta personas, no registros repetidos.'],
  };
}

export function validateBounds(lower: number, upper: number): void {
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) throw new RangeError('Los límites deben ser números finitos');
  if (!(upper > lower)) throw new RangeError('El límite superior debe ser mayor que el inferior');
}

export function boundedSumSensitivity(lower: number, upper: number, neighbouring: Neighbouring = 'add-remove'): SensitivityResult {
  validateBounds(lower, upper);
  if (neighbouring === 'replace') {
    return { value: upper - lower, formula: 'Δ = U − L', assumptions: ['Valores recortados a [L, U] antes de la suma.', 'n es público y no cambia.'] };
  }
  return {
    value: Math.max(Math.abs(lower), Math.abs(upper)),
    formula: 'Δ = max(|L|, |U|)',
    assumptions: ['Valores recortados (clamping) a [L, U] antes de la suma.', 'Los límites L y U son públicos y no dependen de los datos.'],
  };
}

/** Media acotada con n público y vecindad por reemplazo: Δ = (U − L) / n. */
export function boundedMeanSensitivity(lower: number, upper: number, n: number): SensitivityResult {
  validateBounds(lower, upper);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n debe ser un entero positivo');
  return {
    value: (upper - lower) / n,
    formula: 'Δ = (U − L) / n',
    assumptions: [
      'Vecindad por reemplazo: D y D′ tienen el mismo tamaño n, que es público.',
      'Cada valor se recorta (clamping) al intervalo público [L, U] antes de calcular la media.',
      'Los límites L y U se fijan sin mirar los datos (si se derivan de los datos, consumen presupuesto).',
    ],
  };
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function clampedMean(values: readonly number[], lower: number, upper: number): number {
  if (!values.length) return NaN;
  return values.reduce((s, v) => s + clamp(v, lower, upper), 0) / values.length;
}
