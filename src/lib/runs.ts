import { useCallback } from 'react';
import { usePersistentState } from './store';
import { uid } from './utils';

/** Clasificación del tipo de afirmación que hace un resultado (integridad científica). */
export type GuaranteeKind = 'real' | 'sim' | 'formal' | 'concept' | 'empirical' | 'not-computed';

export type ResultValue = number | string | boolean | null;

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
