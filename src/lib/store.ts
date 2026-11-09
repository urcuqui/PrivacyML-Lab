import { useCallback, useSyncExternalStore } from 'react';

/**
 * Almacén de estado persistente (memoria + localStorage) compartido entre componentes.
 * Conserva parámetros y resultados al navegar entre etapas sin perder el estado.
 */
const PREFIX = 'pml:';
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function read<T>(key: string, initial: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = initial;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      // fusión superficial para tolerar nuevos campos en los valores por defecto
      value = isPlainObject(initial) && isPlainObject(parsed) ? ({ ...initial, ...parsed } as T) : (parsed as T);
    }
  } catch {
    /* almacenamiento no disponible: usar valor inicial */
  }
  cache.set(key, value);
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function writeState<T>(key: string, value: T, persist = true) {
  cache.set(key, value);
  if (persist) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* cuota excedida o almacenamiento bloqueado */
    }
  }
  listeners.get(key)?.forEach((l) => l());
}

export function readState<T>(key: string, initial: T): T {
  return read(key, initial);
}

export function clearState(key: string) {
  cache.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignorar */
  }
  listeners.get(key)?.forEach((l) => l());
}

/** Elimina todo el estado guardado del laboratorio. */
export function clearAllState() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignorar */
  }
  const keys = [...cache.keys()];
  cache.clear();
  keys.forEach((k) => listeners.get(k)?.forEach((l) => l()));
}

/**
 * Como useState, pero compartido por clave y persistido en localStorage.
 * `persist = false` mantiene el estado solo en memoria (útil para resultados grandes).
 */
export function usePersistentState<T>(key: string, initial: T, persist = true): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    },
    [key],
  );
  const value = useSyncExternalStore(subscribe, () => read(key, initial));
  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = read(key, initial);
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      writeState(key, next, persist);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, persist],
  );
  const reset = useCallback(() => writeState(key, initial, persist), [key, persist]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, setValue, reset];
}
