import { createSeededRng, deriveSeed } from '../rng/rng';
import { generateBlobs, type Sample } from '../ml/logistic';

export const CLIENT_NAMES = [
  'Hospital Norte',
  'Hospital Sur',
  'Clínica Central',
  'Hospital del Mar',
  'Clínica Montaña',
  'Hospital Universitario',
  'Centro Rural',
  'Hospital Infantil',
  'Clínica del Valle',
  'Hospital Insular',
];

export const FEATURE_NAMES = ['Biomarcador A (normalizado)', 'Biomarcador B (normalizado)'] as const;
export const LABEL_NAME = 'Riesgo alto (1) / bajo (0)';

export type DistributionMode = 'iid' | 'non-iid';

export interface FederatedDataConfig {
  numClients: number;
  samplesPerClient: number;
  mode: DistributionMode;
  /** 0 = clases equilibradas en todos los clientes; 1 = desequilibrio máximo entre clientes. */
  classImbalance: number;
  /** Magnitud del desplazamiento de características (covariate shift) por cliente. */
  featureShift: number;
  /** 0 = todos los clientes con el mismo tamaño; 1 = tamaños muy desiguales. */
  sizeSkew: number;
  /** Fracción de cada cliente reservada como test local. */
  localTestFraction: number;
  /** Tamaño del conjunto de evaluación global fijo. */
  globalTestSize: number;
  seed: number;
  /** Tamaño del conjunto de REFERENCIA común (por defecto = globalTestSize). */
  referenceTestSize?: number;
  /** Semilla del conjunto de referencia (por defecto REFERENCE_SEED). Independiente de `seed` y del modo. */
  referenceSeed?: number;
}

/** Semilla fija del conjunto de referencia común. */
export const REFERENCE_SEED = 20_240_601;

/**
 * POBLACIÓN OBJETIVO DE REFERENCIA (documentada):
 * pacientes de toda la región atendida por la red, con clases equilibradas (P(y = 1) = 0,5) y sin
 * desplazamiento de características (mismo generador `generateBlobs`, shift = 0).
 * - Es independiente del modo (IID / Non-IID), del número de clientes, del desequilibrio y del
 *   desplazamiento configurados, y se genera con su propia semilla ⇒ idéntica en todas las
 *   configuraciones comparadas y disjunta de los datos de entrenamiento.
 * - Coincide con la distribución de entrenamiento del escenario IID: eso es una elección explícita
 *   ("queremos un modelo para la población general") y puede favorecer al escenario IID.
 */
export const REFERENCE_POPULATION = {
  pPositive: 0.5,
  shift: [0, 0] as [number, number],
  description: 'Población general de la región: clases equilibradas (50 % riesgo alto) y sin desplazamiento de características.',
};

export function generateReferenceTest(size: number, seed: number = REFERENCE_SEED): Sample[] {
  const rng = createSeededRng(deriveSeed(seed, 'reference-test'));
  return generateBlobs(size, rng, { pPositive: REFERENCE_POPULATION.pPositive, shift: REFERENCE_POPULATION.shift });
}

export interface ClientData {
  id: number;
  name: string;
  train: Sample[];
  test: Sample[];
  pPositive: number;
  shift: [number, number];
  positiveRate: number;
}

export interface FederatedData {
  clients: ClientData[];
  /** Evaluación del ESCENARIO: mezcla equilibrada de las distribuciones de sus clientes. */
  globalTest: Sample[];
  /** Evaluación de REFERENCIA común: población objetivo fija (ver REFERENCE_POPULATION). */
  referenceTest: Sample[];
  config: FederatedDataConfig;
}

export const DEFAULT_DATA_CONFIG: FederatedDataConfig = {
  numClients: 3,
  samplesPerClient: 120,
  mode: 'iid',
  classImbalance: 0.8,
  featureShift: 1.5,
  sizeSkew: 0,
  localTestFraction: 0.25,
  globalTestSize: 400,
  seed: 42,
};

export function validateDataConfig(c: FederatedDataConfig): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.numClients) || c.numClients < 2 || c.numClients > 10) e.push('El número de clientes debe estar entre 2 y 10.');
  if (!Number.isInteger(c.samplesPerClient) || c.samplesPerClient < 10 || c.samplesPerClient > 2000) e.push('Las muestras por cliente deben estar entre 10 y 2000.');
  if (c.classImbalance < 0 || c.classImbalance > 1) e.push('El desequilibrio de clases debe estar en [0, 1].');
  if (c.featureShift < 0 || c.featureShift > 5) e.push('El desplazamiento de características debe estar en [0, 5].');
  if (c.sizeSkew < 0 || c.sizeSkew > 1) e.push('La asimetría de tamaños debe estar en [0, 1].');
  return e;
}

/** Parámetros de distribución de cada cliente según el modo. */
export function clientDistribution(k: number, c: FederatedDataConfig): { pPositive: number; shift: [number, number] } {
  if (c.mode === 'iid') return { pPositive: 0.5, shift: [0, 0] };
  const K = c.numClients;
  // Proporción de positivos repartida de forma simétrica entre clientes.
  const t = K === 1 ? 0 : (2 * k) / (K - 1) - 1; // en [-1, 1]
  const pPositive = 0.5 + 0.45 * c.classImbalance * t;
  const angle = (2 * Math.PI * k) / K + 0.3;
  const shift: [number, number] = [c.featureShift * Math.cos(angle), c.featureShift * Math.sin(angle)];
  return { pPositive, shift };
}

export function clientSizes(c: FederatedDataConfig): number[] {
  const K = c.numClients;
  if (c.sizeSkew <= 0) return new Array(K).fill(c.samplesPerClient);
  // Pesos geométricos deterministas: el primer cliente es el más grande.
  const ratio = 1 - 0.75 * c.sizeSkew;
  const w = Array.from({ length: K }, (_, k) => ratio ** k);
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((wi) => Math.max(12, Math.round((wi / total) * c.samplesPerClient * K)));
}

export function generateFederatedData(config: FederatedDataConfig): FederatedData {
  const errs = validateDataConfig(config);
  if (errs.length) throw new RangeError(errs.join(' '));
  const sizes = clientSizes(config);
  const clients: ClientData[] = sizes.map((n, k) => {
    const rng = createSeededRng(deriveSeed(config.seed, 'client', k, config.mode));
    const { pPositive, shift } = clientDistribution(k, config);
    const all = generateBlobs(n, rng, { pPositive, shift });
    const nTest = Math.max(2, Math.round(n * config.localTestFraction));
    const test = all.slice(0, nTest);
    const train = all.slice(nTest);
    return {
      id: k,
      name: CLIENT_NAMES[k] ?? `Cliente ${k + 1}`,
      train,
      test,
      pPositive,
      shift,
      positiveRate: train.filter((s) => s.y === 1).length / train.length,
    };
  });
  // Conjunto de evaluación global: mezcla equilibrada de las distribuciones de todos los clientes.
  const testRng = createSeededRng(deriveSeed(config.seed, 'global-test', config.mode));
  const per = Math.ceil(config.globalTestSize / config.numClients);
  const globalTest: Sample[] = [];
  for (let k = 0; k < config.numClients; k++) {
    const { pPositive, shift } = clientDistribution(k, config);
    globalTest.push(...generateBlobs(per, testRng, { pPositive, shift }));
  }
  const referenceTest = generateReferenceTest(config.referenceTestSize ?? config.globalTestSize, config.referenceSeed ?? REFERENCE_SEED);
  return { clients, globalTest, referenceTest, config };
}

export function pooledTrain(data: FederatedData): Sample[] {
  return data.clients.flatMap((c) => c.train);
}
