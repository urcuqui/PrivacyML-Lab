import type { RNG } from '../rng/rng';
import { assertEpsilon } from './laplace';

/** Contabilidad de presupuesto por composición secuencial básica para mecanismos ε-DP puros. */
export interface BudgetEntry {
  id: string;
  label: string;
  epsilon: number;
  trueValue?: number;
  released?: number;
  timestamp: number;
}

export interface BudgetLedger {
  limit: number;
  entries: BudgetEntry[];
}

const EPS_TOL = 1e-12;

export function totalSpent(ledger: BudgetLedger): number {
  return ledger.entries.reduce((s, e) => s + e.epsilon, 0);
}
export function remaining(ledger: BudgetLedger): number {
  return Math.max(0, ledger.limit - totalSpent(ledger));
}

export interface SpendCheck {
  ok: boolean;
  spentAfter: number;
  remainingAfter: number;
  reason?: string;
}

export function checkSpend(ledger: BudgetLedger, epsilon: number): SpendCheck {
  assertEpsilon(epsilon);
  const spentAfter = totalSpent(ledger) + epsilon;
  if (spentAfter > ledger.limit + EPS_TOL) {
    return {
      ok: false,
      spentAfter,
      remainingAfter: ledger.limit - spentAfter,
      reason: `La consulta requiere ε = ${epsilon} pero solo quedan ε = ${remaining(ledger).toFixed(3)}. Ejecutarla superaría el límite ε_total = ${ledger.limit}.`,
    };
  }
  return { ok: true, spentAfter, remainingAfter: ledger.limit - spentAfter };
}

/** Devuelve un nuevo ledger con la entrada añadida; lanza error si se excede el límite. */
export function spend(ledger: BudgetLedger, entry: BudgetEntry): BudgetLedger {
  const check = checkSpend(ledger, entry.epsilon);
  if (!check.ok) throw new RangeError(check.reason);
  return { ...ledger, entries: [...ledger.entries, entry] };
}

/**
 * Compara: (a) una sola publicación con ε, (b) la media de k publicaciones con ε cada una
 * (coste total k·ε por composición secuencial). Muestra que repetir consultas reduce el error
 * del atacante que promedia, es decir, consume privacidad.
 */
export function repeatedReleaseExperiment(trueValue: number, sensitivity: number, epsilon: number, k: number, trials: number, rng: RNG) {
  assertEpsilon(epsilon);
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k debe ser un entero ≥ 1');
  const b = sensitivity / epsilon;
  const single: number[] = [];
  const averaged: number[] = [];
  for (let t = 0; t < trials; t++) {
    single.push(trueValue + rng.laplace(b));
    let s = 0;
    for (let i = 0; i < k; i++) s += trueValue + rng.laplace(b);
    averaged.push(s / k);
  }
  return { single, averaged, scale: b, totalEpsilonAveraged: k * epsilon, totalEpsilonSingle: epsilon };
}
