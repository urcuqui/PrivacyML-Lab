import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type ModuleId = 'dp' | 'fl' | 'combined';

export interface ExperimentMeta {
  id: string;
  module: ModuleId;
  index: number;
  path: string;
  title: string;
  short: string;
  Component: LazyExoticComponent<ComponentType>;
}

export const EXPERIMENTS: ExperimentMeta[] = [
  { id: 'dp1', module: 'dp', index: 1, path: '/dp/1', title: '¿Por qué necesitamos privacidad?', short: 'Conjuntos vecinos', Component: lazy(() => import('./dp/DP1Neighbours')) },
  { id: 'dp2', module: 'dp', index: 2, path: '/dp/2', title: 'Añadir ruido con Privacidad Diferencial', short: 'Mecanismo de Laplace', Component: lazy(() => import('./dp/DP2Laplace')) },
  { id: 'dp3', module: 'dp', index: 3, path: '/dp/3', title: 'Privacidad frente a utilidad', short: 'Privacidad vs utilidad', Component: lazy(() => import('./dp/DP3Utility')) },
  { id: 'dp4', module: 'dp', index: 4, path: '/dp/4', title: 'Composición del presupuesto de privacidad', short: 'Presupuesto ε', Component: lazy(() => import('./dp/DP4Composition')) },
  { id: 'dp5', module: 'dp', index: 5, path: '/dp/5', title: '¿Puede la DP proteger el entrenamiento de modelos?', short: 'DP-SGD', Component: lazy(() => import('./dp/DP5DPSGD')) },
  { id: 'fl1', module: 'fl', index: 1, path: '/fl/1', title: 'Aprendizaje centralizado frente a federado', short: 'Centralizado vs federado', Component: lazy(() => import('./fl/FL1CentralVsFed')) },
  { id: 'fl2', module: 'fl', index: 2, path: '/fl/2', title: 'Construye una ronda de Aprendizaje Federado', short: 'Ronda FedAvg', Component: lazy(() => import('./fl/FL2FedAvg')) },
  { id: 'fl3', module: 'fl', index: 3, path: '/fl/3', title: 'Datos IID frente a Non-IID', short: 'IID vs Non-IID', Component: lazy(() => import('./fl/FL3NonIID')) },
  { id: 'fl4', module: 'fl', index: 4, path: '/fl/4', title: 'Costes de comunicación y de sistema', short: 'Comunicación', Component: lazy(() => import('./fl/FL4Communication')) },
  { id: 'fl5', module: 'fl', index: 5, path: '/fl/5', title: 'Limitaciones de privacidad del Aprendizaje Federado', short: 'Fugas en actualizaciones', Component: lazy(() => import('./fl/FL5Leakage')) },
  { id: 'combined', module: 'combined', index: 1, path: '/combined', title: 'Aprendizaje Federado con Privacidad Diferencial', short: 'FL + DP', Component: lazy(() => import('./combined/Combined')) },
];

export const MODULES: Record<ModuleId, { title: string; short: string; path: string; quizPath: string }> = {
  dp: { title: 'Módulo 1 — Privacidad Diferencial', short: 'Privacidad Diferencial', path: '/dp/1', quizPath: '/quiz/dp' },
  fl: { title: 'Módulo 2 — Aprendizaje Federado', short: 'Aprendizaje Federado', path: '/fl/1', quizPath: '/quiz/fl' },
  combined: { title: 'Módulo 3 — DP + FL', short: 'Experimento combinado', path: '/combined', quizPath: '/quiz/combined' },
};

export function findExperiment(path: string): ExperimentMeta | undefined {
  return EXPERIMENTS.find((e) => e.path === path);
}
export function experimentById(id: string): ExperimentMeta | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
