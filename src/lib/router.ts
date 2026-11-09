import { useSyncExternalStore } from 'react';

/** Enrutador mínimo basado en hash (#/dp/2). Funciona sin servidor y sin conexión. */
function getPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
}
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
export function useRoute(): string {
  return useSyncExternalStore(subscribe, getPath, () => '/');
}
export function navigate(path: string) {
  if (getPath() !== path) window.location.hash = path;
  window.scrollTo({ top: 0 });
}
export function href(path: string): string {
  return `#${path}`;
}
