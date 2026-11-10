/**
 * Sensibilidades globales L1 bajo supuestos explícitos.
 * - Vecindad "añadir/eliminar" (unbounded DP): D' = D ± una persona.
 * - Vecindad "reemplazar" (bounded DP): D' = D con una persona sustituida; n es público.
 */
import { clippedSumSensitivityMultiple, type Adjacency } from '../privacy/model';

/** Alias histórico: la vecindad se define de forma centralizada en lib/privacy/model.ts. */
export type Neighbouring = Adjacency;

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

/**
 * Proporción count/n con n público. Solo está definida bajo vecindad por REEMPLAZO:
 * reemplazar una persona cambia el conteo como mucho en 1 ⇒ Δ₁ = 1/n.
 * Bajo añadir/eliminar, n no es público y dividir por el n real no es un post-procesado válido.
 */
export function proportionSensitivity(n: number): SensitivityResult {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n debe ser un entero positivo');
  return {
    value: 1 / n,
    formula: 'Δ = 1/n (vecindad por reemplazo, n público)',
    assumptions: ['Vecindad por reemplazo: n es público y no cambia.', 'Cada persona aparece una sola vez.'],
  };
}

/**
 * Media bajo añadir/eliminar: NO tiene una sensibilidad global útil si n no es público
 * (con n = 1 frente a n = 2 la media puede cambiar en U − L). Se lanza un error explicativo:
 * la alternativa correcta es publicar suma y conteo con ruido por separado (y dividir después).
 */
export function boundedMeanSensitivityAddRemove(): never {
  throw new RangeError(
    'La media con n desconocido no tiene sensibilidad acotada útil bajo añadir/eliminar: publica la suma acotada y el conteo con ruido por separado (repartiendo ε) y divide después (post-procesado).',
  );
}

/**
 * Sensibilidad L2 de la SUMA de contribuciones recortadas a norma ≤ C:
 * C bajo añadir/eliminar, 2C bajo reemplazo. Válida solo si el denominador es una constante pública.
 */
export function clippedSumL2Sensitivity(clipNorm: number, adjacency: Adjacency): SensitivityResult {
  if (!(clipNorm > 0)) throw new RangeError('La norma de recorte C debe ser positiva');
  const k = clippedSumSensitivityMultiple(adjacency);
  return {
    value: k * clipNorm,
    formula: adjacency === 'replace' ? 'Δ₂ = 2C (v → v′ con ‖v‖, ‖v′‖ ≤ C ⇒ ‖v − v′‖ ≤ 2C)' : 'Δ₂ = C (se añade o elimina un vector de norma ≤ C)',
    assumptions: [
      'Cada contribución se recorta a norma L2 ≤ C antes de sumar.',
      'Cada unidad protegida aporta UNA contribución a la suma (por paso o ronda).',
      'El denominador de la media es una constante pública, no el número real de contribuciones.',
    ],
  };
}
