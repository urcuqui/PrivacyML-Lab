/**
 * Contabilidad RDP (Rényi DP) para composición del mecanismo gaussiano SIN submuestreo.
 *
 * Mecanismo gaussiano con sensibilidad L2 Δ y ruido N(0, (σΔ)²): ε_RDP(α) = α / (2σ²).
 * Composición adaptativa de T pasos: T·α / (2σ²).
 * Conversión a (ε, δ)-DP (Mironov 2017, Prop. 3): ε = ε_RDP(α) + ln(1/δ) / (α − 1).
 *
 * Esta cota es VÁLIDA pero CONSERVADORA. Solo se aplica cuando cada paso usa todos los
 * registros (o todos los clientes): no explota la amplificación por submuestreo, que requeriría
 * un contador específico (p. ej. Poisson subsampled Gaussian) no implementado aquí.
 */
export interface GaussianAccountingInput {
  noiseMultiplier: number;
  steps: number;
  delta: number;
}
export interface AccountingResult {
  status: 'computed';
  epsilon: number;
  delta: number;
  optimalAlpha: number;
  assumptions: string[];
}
export interface NotComputed {
  status: 'not-computed';
  reason: string;
}
export type PrivacyAccounting = AccountingResult | NotComputed;

export function gaussianRdp(alpha: number, noiseMultiplier: number, steps: number): number {
  return (steps * alpha) / (2 * noiseMultiplier * noiseMultiplier);
}

export function gaussianCompositionEpsilon({ noiseMultiplier, steps, delta }: GaussianAccountingInput): AccountingResult {
  if (!(noiseMultiplier > 0)) throw new RangeError('El multiplicador de ruido debe ser > 0');
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError('El número de pasos debe ser un entero ≥ 1');
  if (!(delta > 0 && delta < 1)) throw new RangeError('δ debe estar en (0, 1)');
  const logInvDelta = Math.log(1 / delta);
  // Óptimo analítico: α* = 1 + sqrt(2σ² ln(1/δ) / T); se refina con búsqueda en malla.
  let bestEps = Infinity;
  let bestAlpha = 2;
  const candidates: number[] = [];
  for (let a = 1.01; a < 10; a += 0.01) candidates.push(a);
  for (let a = 10; a <= 5000; a *= 1.01) candidates.push(a);
  candidates.push(1 + Math.sqrt((2 * noiseMultiplier ** 2 * logInvDelta) / steps));
  for (const a of candidates) {
    if (a <= 1) continue;
    const e = gaussianRdp(a, noiseMultiplier, steps) + logInvDelta / (a - 1);
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
    assumptions: [
      'Mecanismo gaussiano ideal: muestreo exacto de N(0, σ²C²) con aleatoriedad segura (no el PRNG con semilla del laboratorio).',
      'Sensibilidad L2 de cada paso = C, garantizada por el recorte (clipping) a norma C.',
      'Cada paso utiliza todas las unidades protegidas (sin submuestreo): no se aplica amplificación.',
      'Se publican todos los modelos intermedios (composición adaptativa de T pasos vía RDP).',
      'Normalización por una constante pública (no por el tamaño real del lote).',
    ],
  };
}
