/**
 * Modelo de coste de comunicación SIMPLIFICADO: cuenta solo la carga útil de parámetros
 * (float32 = 4 bytes). No incluye cabeceras de protocolo, cifrado, compresión, reintentos,
 * latencia, ni asimetría de ancho de banda subida/bajada.
 */
export const BYTES_PER_PARAM = 4;

export interface CommEstimateInput {
  numParams: number;
  numClients: number;
  participation: number;
  rounds: number;
  bytesPerParam?: number;
}

export interface CommEstimate {
  clientsPerRound: number;
  downPerRound: number;
  upPerRound: number;
  perRound: number;
  total: number;
}

export function estimateCommunication({ numParams, numClients, participation, rounds, bytesPerParam = BYTES_PER_PARAM }: CommEstimateInput): CommEstimate {
  if (!(numParams > 0) || !(rounds > 0) || !(numClients > 0)) throw new RangeError('Parámetros de comunicación no válidos');
  const m = Math.max(1, Math.min(numClients, Math.round(participation * numClients)));
  const down = m * numParams * bytesPerParam;
  const up = m * numParams * bytesPerParam;
  return { clientsPerRound: m, downPerRound: down, upPerRound: up, perRound: down + up, total: rounds * (down + up) };
}

export function formatBytes(b: number): string {
  if (!Number.isFinite(b)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: v < 10 ? 2 : 1 })} ${units[i]}`;
}

/** Tamaños de modelo de referencia para extrapolar (número de parámetros aproximado). */
export const REFERENCE_MODELS = [
  { id: 'lab', name: 'Regresión logística del laboratorio (2 características + sesgo)', params: 3 },
  { id: 'mlp', name: 'MLP pequeño (≈ 100 mil parámetros)', params: 100_000 },
  { id: 'resnet18', name: 'CNN tipo ResNet-18 (≈ 11,7 millones)', params: 11_700_000 },
  { id: 'bert', name: 'Transformer tipo BERT-base (≈ 110 millones)', params: 110_000_000 },
] as const;
