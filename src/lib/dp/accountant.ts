/**
 * Contabilidad RDP (Rényi DP) para la composición del mecanismo gaussiano SIN submuestreo.
 *
 * Mecanismo gaussiano con sensibilidad L2 Δ y ruido N(0, s²·I):
 *     ε_RDP(α) = α·Δ² / (2 s²).
 * En DP-SGD / DP-FedAvg el ruido es s = σ·C y la sensibilidad Δ = k·C, donde k depende de la
 * vecindad (k = 1 añadir/eliminar, k = 2 reemplazar). Con z = s/Δ = σ/k (multiplicador efectivo):
 *     ε_RDP(α) = α / (2 z²)  por composición.
 * Composición adaptativa de T mecanismos: T·α / (2 z²).
 * Conversión a (ε, δ)-DP (Mironov 2017, Prop. 3): ε = ε_RDP(α) + ln(1/δ) / (α − 1), minimizando en α > 1.
 *
 * Esta cota es VÁLIDA pero CONSERVADORA: no explota la amplificación por submuestreo, que
 * requeriría muestreo de Poisson y un contador específico no implementado aquí.
 */
import { normalCdf } from '../stats';

export interface GaussianAccountingInput {
  /** σ: el ruido es N(0, (σC)²) por coordenada. */
  noiseMultiplier: number;
  /** Número de composiciones T (pasos o rondas en los que la unidad protegida puede influir). */
  steps: number;
  delta: number;
  /** k: la sensibilidad L2 de cada composición es k·C (1 = añadir/eliminar, 2 = reemplazar). Por defecto 1. */
  sensitivityMultiple?: number;
}

export interface AccountingDetails {
  /** Multiplicador efectivo z = σ / k. */
  effectiveNoiseMultiplier: number;
  sensitivityMultiple: number;
  compositions: number;
  /** ε_RDP total en el α óptimo. */
  rdpAtOptimalAlpha: number;
  /** Parámetro μ de μ-GDP equivalente (√T / z), usado como referencia exacta. */
  gdpMu: number;
}

export interface AccountingResult {
  status: 'computed';
  epsilon: number;
  delta: number;
  optimalAlpha: number;
  assumptions: string[];
  details: AccountingDetails;
}
export interface NotComputed {
  status: 'not-computed';
  reason: string;
}
export type PrivacyAccounting = AccountingResult | NotComputed;

/** ε_RDP(α) de T composiciones gaussianas con multiplicador EFECTIVO z. */
export function gaussianRdp(alpha: number, effectiveNoiseMultiplier: number, steps: number): number {
  return (steps * alpha) / (2 * effectiveNoiseMultiplier * effectiveNoiseMultiplier);
}

export function validateAccountingInput({ noiseMultiplier, steps, delta, sensitivityMultiple = 1 }: GaussianAccountingInput): void {
  if (!(noiseMultiplier > 0) || !Number.isFinite(noiseMultiplier)) throw new RangeError('El multiplicador de ruido debe ser > 0 y finito');
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError('El número de pasos debe ser un entero ≥ 1');
  if (!(delta > 0 && delta < 1)) throw new RangeError('δ debe estar en (0, 1)');
  if (!(sensitivityMultiple > 0) || !Number.isFinite(sensitivityMultiple)) throw new RangeError('El múltiplo de sensibilidad debe ser > 0');
}

export function gaussianCompositionEpsilon(input: GaussianAccountingInput): AccountingResult {
  validateAccountingInput(input);
  const { noiseMultiplier, steps, delta } = input;
  const k = input.sensitivityMultiple ?? 1;
  const z = noiseMultiplier / k;
  const logInvDelta = Math.log(1 / delta);
  // Óptimo analítico: α* = 1 + sqrt(2 z² ln(1/δ) / T); se refina con búsqueda en malla.
  let bestEps = Infinity;
  let bestAlpha = 2;
  const candidates: number[] = [];
  for (let a = 1.01; a < 10; a += 0.01) candidates.push(a);
  for (let a = 10; a <= 5000; a *= 1.01) candidates.push(a);
  candidates.push(1 + Math.sqrt((2 * z * z * logInvDelta) / steps));
  for (const a of candidates) {
    if (a <= 1) continue;
    const e = gaussianRdp(a, z, steps) + logInvDelta / (a - 1);
    if (e < bestEps) {
      bestEps = e;
      bestAlpha = a;
    }
  }
  return {
    status: 'computed',
    epsilon: bestEps,
    delta,
    optimalAlpha: bestAlpha,
    details: {
      effectiveNoiseMultiplier: z,
      sensitivityMultiple: k,
      compositions: steps,
      rdpAtOptimalAlpha: gaussianRdp(bestAlpha, z, steps),
      gdpMu: Math.sqrt(steps) / z,
    },
    assumptions: [
      'Mecanismo gaussiano ideal: muestreo exacto de N(0, σ²C²) con aleatoriedad segura (no el PRNG con semilla del laboratorio).',
      `Sensibilidad L2 de cada composición = ${k === 1 ? 'C' : `${k}C`}, garantizada por el recorte (clipping) a norma C y la vecindad indicada.`,
      `Multiplicador efectivo z = σ/${k} = ${z.toPrecision(4)}; ε_RDP(α) = T·α/(2z²) con T = ${steps}.`,
      'Composición adaptativa: se asume que se publican TODOS los modelos intermedios.',
      'Sin amplificación por submuestreo: cota válida pero conservadora.',
      'Normalización por una constante pública (no por un tamaño que dependa de los datos).',
      'Conversión RDP → (ε, δ) de Mironov (2017): ε = ε_RDP(α) + ln(1/δ)/(α − 1).',
    ],
  };
}

/**
 * Referencia EXACTA (no se usa para mostrar ε): la composición de T mecanismos gaussianos con
 * multiplicador efectivo z es μ-GDP con μ = √T / z (Dong, Roth y Su, 2019), cuya curva de
 * privacidad es  δ(ε) = Φ(−ε/μ + μ/2) − e^ε · Φ(−ε/μ − μ/2).
 * Sirve para comprobar en las pruebas que la cota RDP es correcta (δ_exacto(ε_RDP) ≤ δ).
 */
export function gaussianExactDelta(epsilon: number, mu: number): number {
  if (!(mu > 0)) throw new RangeError('μ debe ser positivo');
  return normalCdf(-epsilon / mu + mu / 2) - Math.exp(epsilon) * normalCdf(-epsilon / mu - mu / 2);
}

/** ε exacto (por bisección) para la composición gaussiana: menor ε con δ_exacto(ε) ≤ δ. */
export function gaussianExactEpsilon(mu: number, delta: number): number {
  let lo = 0;
  let hi = 1;
  while (gaussianExactDelta(hi, mu) > delta) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (gaussianExactDelta(mid, mu) > delta) lo = mid;
    else hi = mid;
  }
  return hi;
}
