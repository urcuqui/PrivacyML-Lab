/// <reference lib="webworker" />
import { TASKS, type TaskName } from '../lib/tasks';

interface Req {
  id: number;
  task: TaskName;
  payload: unknown;
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, task, payload } = ev.data;
  try {
    const fn = TASKS[task] as (p: unknown) => unknown;
    if (!fn) throw new Error(`Tarea desconocida: ${task}`);
    const result = fn(payload);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
