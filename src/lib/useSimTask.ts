import { useCallback, useEffect, useRef, useState } from 'react';
import { TASKS, type TaskInput, type TaskName, type TaskOutput } from './tasks';

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = pending.get(ev.data.id);
        if (!p) return;
        pending.delete(ev.data.id);
        if (ev.data.ok) p.resolve(ev.data.result);
        else p.reject(new Error(ev.data.error));
      };
      worker.onerror = () => {
        workerFailed = true;
        pending.forEach((p) => p.reject(new Error('El Web Worker falló; reintenta.')));
        pending.clear();
        worker = null;
      };
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

/** Ejecuta una tarea de simulación en un Web Worker (o en el hilo principal como respaldo). */
export function runSimTask<K extends TaskName>(task: K, payload: TaskInput<K>): Promise<TaskOutput<K>> {
  const w = getWorker();
  if (!w) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve((TASKS[task] as (p: TaskInput<K>) => TaskOutput<K>)(payload));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, 0);
    });
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, task, payload });
  });
}

/** Hook: estado de carga/error/resultado para una tarea de simulación. */
export function useSimTask<K extends TaskName>(task: K) {
  const [result, setResult] = useState<TaskOutput<K> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async (payload: TaskInput<K>) => {
      setRunning(true);
      setError(null);
      try {
        const r = await runSimTask(task, payload);
        if (alive.current) setResult(r);
        return r;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        if (alive.current) setRunning(false);
      }
    },
    [task],
  );
  return { result, error, running, run, setResult };
}
