/**
 * Representación CENTRALIZADA de los supuestos de privacidad del laboratorio.
 *
 * Toda garantía de privacidad diferencial depende de:
 *  - la UNIDAD protegida (un registro o un cliente completo),
 *  - la definición de VECINDAD (añadir/eliminar frente a reemplazar),
 *  - la SENSIBILIDAD real del mecanismo bajo esa vecindad,
 *  - el MODELO DE CONFIANZA (quién ve qué antes de añadir el ruido),
 *  - las SALIDAS publicadas (todas deben estar cubiertas por la contabilidad).
 */
export type Adjacency = 'add-remove' | 'replace';
export type PrivacyUnit = 'record' | 'client';

export const ADJACENCY_INFO: Record<Adjacency, { label: string; definition: string; sizeNote: string }> = {
  'add-remove': {
    label: 'Añadir / eliminar (unbounded DP)',
    definition: 'D′ se obtiene de D añadiendo o eliminando UNA unidad protegida. El tamaño del conjunto puede cambiar.',
    sizeNote: 'El tamaño n (o el número de clientes K) NO se considera público: cualquier denominador debe ser una constante fijada de antemano, no el tamaño real.',
  },
  replace: {
    label: 'Reemplazar (bounded DP)',
    definition: 'D′ se obtiene de D sustituyendo los datos de UNA unidad protegida por otros cualesquiera. El tamaño n (o K) es el mismo y es público.',
    sizeNote: 'n (o K) es público. Como una contribución puede pasar de un extremo al opuesto, la sensibilidad suele duplicarse respecto a añadir/eliminar.',
  },
};

export const UNIT_INFO: Record<PrivacyUnit, { label: string; definition: string }> = {
  record: { label: 'Registro (record-level DP)', definition: 'Se protege la presencia o el contenido de UN ejemplo de entrenamiento o UNA fila del conjunto de datos.' },
  client: {
    label: 'Cliente (client-level DP)',
    definition: 'Se protege la contribución COMPLETA de un cliente (todos sus registros a la vez). Es una garantía más fuerte que la de registro para el mismo ε.',
  },
};

/**
 * Sensibilidad L2 de una SUMA de contribuciones recortadas a norma ≤ C.
 * - Añadir/eliminar: la suma cambia en una contribución completa ⇒ Δ₂ ≤ C.
 * - Reemplazar: cambia v por v′ con ‖v‖,‖v′‖ ≤ C ⇒ ‖v − v′‖ ≤ 2C.
 * Requiere que el denominador de la media (si lo hay) sea una constante pública.
 */
export function clippedSumSensitivityMultiple(adjacency: Adjacency): 1 | 2 {
  return adjacency === 'replace' ? 2 : 1;
}

export interface PrivacySpec {
  /** Nombre del mecanismo. */
  mechanism: string;
  unit: PrivacyUnit;
  adjacency: Adjacency;
  /** Norma de la sensibilidad usada para calibrar el ruido. */
  sensitivityNorm: 'L1' | 'L2';
  /** Descripción (con fórmula) de la sensibilidad bajo la vecindad indicada. */
  sensitivity: string;
  /** Distribución del ruido. */
  noise: string;
  /** Quién debe ser de confianza para que la garantía tenga sentido. */
  trustModel: string;
  /** Salidas cubiertas por la garantía. */
  coveredOutputs: string[];
  /** Salidas que el laboratorio muestra con fines didácticos pero que NO están cubiertas. */
  outsideGuarantee: string[];
  /** Frente a quién protege / frente a quién no. */
  protectsAgainst: string[];
  doesNotProtectAgainst: string[];
}

const SEEDED_RNG_NOTE = 'El ruido se genera con un PRNG con semilla (Mulberry32) en punto flotante: la garantía describe el mecanismo matemático ideal, no esta implementación.';

export function laplaceCountSpec(adjacency: Adjacency = 'add-remove'): PrivacySpec {
  return {
    mechanism: 'Mecanismo de Laplace sobre un conteo',
    unit: 'record',
    adjacency,
    sensitivityNorm: 'L1',
    sensitivity: 'Δ₁ = 1: añadir, eliminar o reemplazar a una persona cambia un conteo como mucho en 1.',
    noise: 'Lap(0, b) con b = Δ₁/ε',
    trustModel: 'Curador de confianza: calcula el conteo exacto sobre los datos y publica solo el valor con ruido.',
    coveredOutputs: ['Cada valor publicado M(D) = f(D) + Lap(Δ₁/ε). Varias publicaciones se componen (ε se suma).'],
    outsideGuarantee: ['El valor exacto f(D) mostrado en el laboratorio (en un despliegue real nunca se publicaría).', 'Las repeticiones didácticas: cada una consumiría ε adicional en un sistema real.'],
    protectsAgainst: ['Cualquier observador del valor publicado, incluso con información auxiliar arbitraria, en el sentido de la definición de DP.'],
    doesNotProtectAgainst: ['El propio curador, que ve los datos exactos.', 'Inferencias sobre la población (no sobre una persona concreta) que el resultado permite legítimamente.', SEEDED_RNG_NOTE],
  };
}

export function boundedMeanSpec(lower: number, upper: number, n: number): PrivacySpec {
  return {
    mechanism: 'Mecanismo de Laplace sobre una media acotada',
    unit: 'record',
    adjacency: 'replace',
    sensitivityNorm: 'L1',
    sensitivity: `Δ₁ = (U − L)/n = (${upper} − ${lower})/${n}, con valores recortados a [L, U] públicos y n público (vecindad por reemplazo).`,
    noise: 'Lap(0, b) con b = Δ₁/ε',
    trustModel: 'Curador de confianza.',
    coveredOutputs: ['La media publicada con ruido.'],
    outsideGuarantee: ['La media exacta y el sesgo de recorte mostrados con fines didácticos.', 'Elegir L y U mirando los datos consumiría privacidad adicional (no contabilizada aquí).'],
    protectsAgainst: ['Observadores de la media publicada.'],
    doesNotProtectAgainst: ['El curador.', 'Bajo vecindad añadir/eliminar con n desconocido esta Δ NO es válida: habría que publicar suma y conteo ruidosos por separado.', SEEDED_RNG_NOTE],
  };
}

export function compositionSpec(): PrivacySpec {
  return {
    mechanism: 'Composición secuencial de mecanismos de Laplace (ε-DP puro)',
    unit: 'record',
    adjacency: 'replace',
    sensitivityNorm: 'L1',
    sensitivity: 'Cada consulta usa su propia Δ₁ bajo vecindad por reemplazo con n público: conteos Δ₁ = 1; media acotada Δ₁ = (U − L)/n.',
    noise: 'Lap(0, Δ₁/εᵢ) por consulta',
    trustModel: 'Curador de confianza que lleva la contabilidad del presupuesto.',
    coveredOutputs: ['Todas las respuestas publicadas: la garantía total es Σ εᵢ (composición secuencial básica).'],
    outsideGuarantee: ['Los valores exactos mostrados para comparar.'],
    protectsAgainst: ['Observadores de todas las respuestas publicadas, incluso si las combinan (promedian).'],
    doesNotProtectAgainst: ['Consultas fuera del registro de presupuesto.', 'Cambiar la semilla no repone el presupuesto: cada publicación cuenta.', SEEDED_RNG_NOTE],
  };
}

export function dpsgdSpec(adjacency: Adjacency): PrivacySpec {
  const k = clippedSumSensitivityMultiple(adjacency);
  return {
    mechanism: 'DP-SGD (gradientes por ejemplo recortados + ruido gaussiano)',
    unit: 'record',
    adjacency,
    sensitivityNorm: 'L2',
    sensitivity:
      adjacency === 'replace'
        ? 'Δ₂ = 2C por paso en que participa el registro: reemplazar un ejemplo cambia la suma de gradientes recortados de g a g′ con ‖g‖, ‖g′‖ ≤ C.'
        : 'Δ₂ = C por paso: añadir o eliminar un ejemplo cambia la suma de gradientes recortados en un vector de norma ≤ C. Requiere lote completo y denominador B constante y público.',
    noise: `N(0, σ²C²·I) sobre la suma; multiplicador efectivo z = σ/${k}`,
    trustModel: 'Entrenador de confianza: calcula gradientes por ejemplo sobre los datos en claro antes de añadir ruido.',
    coveredOutputs: ['La secuencia completa de parámetros θ₁, …, θ_T (se asume que se publican todos los modelos intermedios).'],
    outsideGuarantee: [
      'Pérdida y precisión de ENTRENAMIENTO calculadas sin ruido sobre los datos privados (instrumentación didáctica).',
      'Fracción de gradientes recortados y vectores por ejemplo mostrados en la visualización.',
      'El conjunto de test se trata como datos NO protegidos (evaluación independiente).',
      'La selección de hiperparámetros (C, σ, η, B, T) mirando los resultados: no se contabiliza.',
    ],
    protectsAgainst: ['Quien observe los parámetros publicados del modelo (p. ej. ataques de inferencia de pertenencia sobre el modelo).'],
    doesNotProtectAgainst: ['El entrenador, que ve los datos y los gradientes en claro.', SEEDED_RNG_NOTE],
  };
}

export function dpFedAvgSpec(adjacency: Adjacency): PrivacySpec {
  const k = clippedSumSensitivityMultiple(adjacency);
  return {
    mechanism: 'DP-FedAvg a nivel de cliente con ruido añadido por el servidor (DP central)',
    unit: 'client',
    adjacency,
    sensitivityNorm: 'L2',
    sensitivity:
      adjacency === 'replace'
        ? 'Δ₂ = 2C por ronda: reemplazar todos los datos de un cliente cambia su actualización recortada de Δ a Δ′ con ‖Δ‖, ‖Δ′‖ ≤ C. K es público y la selección de clientes no depende de los datos.'
        : 'Δ₂ = C por ronda: añadir o eliminar un cliente cambia la suma de actualizaciones recortadas en un vector de norma ≤ C. Requiere participación total y denominador m̄ constante y público.',
    noise: `N(0, σ²C²·I) sobre la suma de actualizaciones recortadas, dividido por m̄ (constante pública); multiplicador efectivo z = σ/${k}`,
    trustModel:
      'Servidor de agregación de CONFIANZA: recibe cada actualización Δ_k individual en claro, la recorta y añade el ruido. La DP central NO impide que el servidor vea las actualizaciones individuales.',
    coveredOutputs: ['La secuencia de modelos globales publicados w₁, …, w_T (se asume que se publican todos los modelos intermedios).'],
    outsideGuarantee: [
      'Las actualizaciones individuales Δ_k (visibles para el servidor y mostradas en el laboratorio).',
      'Pérdida de entrenamiento y precisión local por cliente calculadas sin ruido (instrumentación didáctica).',
      'Norma media de las actualizaciones y fracción recortada.',
      'El conjunto de evaluación global se trata como datos NO protegidos.',
    ],
    protectsAgainst: ['Observadores EXTERNOS de los modelos globales publicados: otros clientes, analistas, usuarios del modelo final.'],
    doesNotProtectAgainst: [
      'El propio servidor de agregación (ve cada Δ_k). Para reducir esa confianza se necesita agregación segura y/o ruido distribuido o local.',
      'Ataques sobre las actualizaciones antes de la agregación si el canal no está protegido.',
      SEEDED_RNG_NOTE,
    ],
  };
}

/** Limitaciones generales que se añaden a TODO informe exportado. */
export const GENERAL_LIMITATIONS = [
  'Datos 100 % sintéticos generados en el navegador; no representan personas reales.',
  'La aleatoriedad con semilla (Mulberry32) es una herramienta de REPRODUCIBILIDAD educativa, no aleatoriedad segura para producción.',
  'Las implementaciones en punto flotante de Laplace/Gauss pueden filtrar información (Mironov, 2012); sustituir el PRNG por uno criptográfico no basta para que sean seguras en producción.',
  'Las precisiones y pérdidas son observaciones empíricas sobre un modelo de 3 parámetros y no predicen el rendimiento de sistemas reales.',
];
