import { useCallback } from 'react';
import { usePersistentState } from './store';
import { uid } from './utils';
import type { PrivacyAccounting } from './dp/accountant';
import { ADJACENCY_INFO, UNIT_INFO, type Adjacency, type PrivacySpec, type PrivacyUnit } from './privacy/model';

/** Clasificación del tipo de afirmación que hace un resultado (integridad científica). */
export type GuaranteeKind = 'real' | 'sim' | 'formal' | 'concept' | 'empirical' | 'not-computed';

export type ResultValue = number | string | boolean | null;

/** Registro de privacidad de una ejecución (se exporta en JSON e informes). */
export interface PrivacyRecord {
  mechanism: string;
  unit: PrivacyUnit;
  adjacency: Adjacency;
  sensitivity: string;
  noise: string;
  clipNorm: number | null;
  noiseMultiplier: number | null;
  /** 'computed' = ε calculado por el contador; 'not-computed' = mecanismo con ruido pero sin contabilidad válida; 'pure' = ε-DP puro (Laplace). */
  status: 'computed' | 'not-computed' | 'pure';
  epsilon: number | null;
  delta: number | null;
  /** Motivo cuando no se calcula ε. */
  reason: string | null;
  accountantAssumptions: string[];
  trustModel: string;
  outsideGuarantee: string[];
}

/** Construye el registro de privacidad a partir de la especificación y la contabilidad. */
export function privacyRecord(
  spec: PrivacySpec,
  accounting: PrivacyAccounting | { status: 'pure'; epsilon: number },
  extras: { clipNorm?: number | null; noiseMultiplier?: number | null } = {},
): PrivacyRecord {
  return {
    mechanism: spec.mechanism,
    unit: spec.unit,
    adjacency: spec.adjacency,
    sensitivity: spec.sensitivity,
    noise: spec.noise,
    clipNorm: extras.clipNorm ?? null,
    noiseMultiplier: extras.noiseMultiplier ?? null,
    status: accounting.status,
    epsilon: accounting.status === 'not-computed' ? null : accounting.epsilon,
    delta: accounting.status === 'computed' ? accounting.delta : accounting.status === 'pure' ? 0 : null,
    reason: accounting.status === 'not-computed' ? accounting.reason : null,
    accountantAssumptions: accounting.status === 'computed' ? accounting.assumptions : [],
    trustModel: spec.trustModel,
    outsideGuarantee: spec.outsideGuarantee,
  };
}

export function describeUnit(u: PrivacyUnit): string {
  return UNIT_INFO[u].label;
}
export function describeAdjacency(a: Adjacency): string {
  return ADJACENCY_INFO[a].label;
}

export interface ExperimentRun {
  id: string;
  experimentId: string;
  experimentTitle: string;
  name: string;
  createdAt: number;
  seed: number | null;
  params: Record<string, ResultValue>;
  results: Record<string, ResultValue>;
  assumptions: string[];
  limitations: string[];
  /** Garantía de privacidad establecida (texto) o null si no hay. */
  privacyGuarantee: string | null;
  /** Modelo de privacidad detallado (opcional; ausente en ejecuciones antiguas o sin mecanismo DP). */
  privacy?: PrivacyRecord;
  /** Configuración del conjunto de datos (opcional). */
  dataConfig?: Record<string, ResultValue>;
  /** Guardado explícitamente en el historial del estudiante. */
  saved: boolean;
  notes: string;
}

const KEY = 'runs';
const MAX_UNSAVED_PER_EXPERIMENT = 15;

export function useAllRuns() {
  return usePersistentState<ExperimentRun[]>(KEY, []);
}

/** Ejecuciones de un experimento (línea temporal) + acciones. */
export function useRuns(experimentId: string) {
  const [all, setAll] = useAllRuns();
  const runs = all.filter((r) => r.experimentId === experimentId).sort((a, b) => a.createdAt - b.createdAt);

  const addRun = useCallback(
    (run: Omit<ExperimentRun, 'id' | 'createdAt' | 'saved' | 'notes' | 'name' | 'experimentId'> & { name?: string; notes?: string }) => {
      const id = uid('run');
      setAll((prev) => {
        const mine = prev.filter((r) => r.experimentId === experimentId);
        const n = mine.length + 1;
        const next: ExperimentRun = {
          ...run,
          id,
          experimentId,
          createdAt: Date.now(),
          saved: false,
          notes: run.notes ?? '',
          name: run.name ?? `Ejecución ${n}`,
        };
        let list = [...prev, next];
        // limitar ejecuciones no guardadas por experimento
        const unsaved = list.filter((r) => r.experimentId === experimentId && !r.saved);
        if (unsaved.length > MAX_UNSAVED_PER_EXPERIMENT) {
          const drop = new Set(unsaved.slice(0, unsaved.length - MAX_UNSAVED_PER_EXPERIMENT).map((r) => r.id));
          list = list.filter((r) => !drop.has(r.id));
        }
        return list;
      });
      return id;
    },
    [experimentId, setAll],
  );
  const updateRun = useCallback((id: string, patch: Partial<ExperimentRun>) => setAll((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))), [setAll]);
  const removeRun = useCallback((id: string) => setAll((prev) => prev.filter((r) => r.id !== id)), [setAll]);
  const clearUnsaved = useCallback(() => setAll((prev) => prev.filter((r) => r.experimentId !== experimentId || r.saved)), [experimentId, setAll]);
  return { runs, addRun, updateRun, removeRun, clearUnsaved };
}
