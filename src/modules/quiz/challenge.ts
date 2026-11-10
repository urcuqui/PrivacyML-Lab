/**
 * Reto práctico final: elegir una configuración de ML con preservación de privacidad para
 * organizaciones ficticias con requisitos explícitos. La evaluación es un razonamiento
 * cualitativo basado en reglas (no una simulación); puede haber más de una respuesta aceptable.
 */
import { laplaceScale } from '@/lib/dp/laplace';

export type Architecture = 'central' | 'fl' | 'fldp' | 'fldpsa' | 'dpstats';
export type PrivacyUnit = 'record' | 'client';
export type NoiseLevel = 'none' | 'low' | 'medium' | 'high';
export type ParticipationLevel = 'low' | 'medium' | 'full';
export type EpochsLevel = 'few' | 'moderate' | 'many';

export interface ChallengeChoice {
  architecture: Architecture | null;
  unit: PrivacyUnit;
  noise: NoiseLevel;
  participation: ParticipationLevel;
  epochs: EpochsLevel;
}

export const DEFAULT_CHOICE: ChallengeChoice = { architecture: null, unit: 'record', noise: 'medium', participation: 'full', epochs: 'moderate' };

export const ARCHITECTURES: { id: Architecture; label: string; desc: string }[] = [
  { id: 'central', label: 'Centralizado', desc: 'Los datos se envían a un servidor central que entrena el modelo o calcula las estadísticas.' },
  { id: 'fl', label: 'Aprendizaje Federado (FedAvg)', desc: 'Los datos se quedan en los clientes; se intercambian modelos y actualizaciones.' },
  { id: 'fldp', label: 'FL + DP (ruido en el servidor)', desc: 'Actualizaciones recortadas y ruido gaussiano añadido por un agregador de confianza (DP central).' },
  { id: 'fldpsa', label: 'FL + DP + Agregación segura', desc: 'El servidor solo ve la suma de actualizaciones; el ruido de DP se reparte entre los clientes.' },
  { id: 'dpstats', label: 'DP sobre estadísticas publicadas (Laplace)', desc: 'No se entrena un modelo: se publican conteos o medias con ruido de Laplace y un presupuesto ε.' },
];

export const NOISE_LABELS: Record<NoiseLevel, string> = {
  none: 'Sin ruido',
  low: 'Ruido bajo (ε ≈ 8–10)',
  medium: 'Ruido medio (ε ≈ 1–4)',
  high: 'Ruido alto (ε < 0,5)',
};
export const UNIT_LABELS: Record<PrivacyUnit, string> = { record: 'Registro / persona individual', client: 'Cliente completo (dispositivo, hospital…)' };
export const PARTICIPATION_LABELS: Record<ParticipationLevel, string> = { low: 'Baja (< 1 % por ronda)', medium: 'Media (≈ 30–50 %)', full: 'Total (100 %)' };
export const EPOCHS_LABELS: Record<EpochsLevel, string> = { few: 'Pocas (1)', moderate: 'Moderadas (2–5)', many: 'Muchas (≥ 20)' };

export type Status = 'meets' | 'partial' | 'fails';
export interface Evaluation {
  requirement: string;
  status: Status;
  explanation: string;
}

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  facts: string[];
  requirements: { label: string; kind: 'accuracy' | 'privacy' | 'communication' | 'other'; text: string }[];
  evaluate: (c: ChallengeChoice) => Evaluation[];
  /** Solución razonada (se muestra tras evaluar). */
  discussion: string[];
}

const usesFL = (a: Architecture | null) => a === 'fl' || a === 'fldp' || a === 'fldpsa';
const usesDP = (a: Architecture | null) => a === 'fldp' || a === 'fldpsa' || a === 'dpstats';
const fmt = (x: number, d = 1) => x.toLocaleString('es-ES', { maximumFractionDigits: d });

// Ejemplo calculado para la agencia: conteo (Δ = 1) con ε total 1 repartido en 10 tablas que afectan a la misma persona.
const AGENCY_B_MEDIUM = laplaceScale(1, 1 / 10);
const AGENCY_B_HIGH = laplaceScale(1, 0.2 / 10);

function noDP(a: Architecture | null): Evaluation {
  return {
    requirement: 'Garantía formal de privacidad',
    status: 'fails',
    explanation:
      a === 'fl'
        ? 'FedAvg sin DP no ofrece garantía formal: las actualizaciones y el modelo final pueden revelar información de los datos locales (ver Módulo 2, Experimento 5).'
        : 'Sin un mecanismo de DP, el modelo o las estadísticas publicadas no tienen ninguna cota sobre lo que revelan de cada individuo.',
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'hospitals',
    name: 'Red Hospitalaria Atlántica',
    summary: 'Cinco hospitales quieren entrenar conjuntamente un modelo de riesgo de reingreso.',
    facts: [
      '5 hospitales, ≈ 20 000 pacientes cada uno; las poblaciones difieren algo entre hospitales (datos non-IID moderados).',
      'Conexiones de red estables; todos los hospitales están disponibles en cada ronda.',
      'Los hospitales no confían plenamente en la empresa que opera el servidor de agregación.',
    ],
    requirements: [
      { label: 'Residencia', kind: 'other', text: 'Por normativa, los historiales clínicos no pueden salir de cada hospital.' },
      { label: 'Precisión', kind: 'accuracy', text: 'Como mucho 3 puntos por debajo de un modelo centralizado de referencia.' },
      { label: 'Privacidad', kind: 'privacy', text: 'Garantía formal que limite lo que el modelo publicado revela de cada paciente (ε ≤ 4 aprox.).' },
      { label: 'Comunicación', kind: 'communication', text: 'Ancho de banda holgado, pero se desea terminar en un número razonable de rondas.' },
    ],
    evaluate: (c) => {
      const a = c.architecture;
      const out: Evaluation[] = [];
      // Residencia
      out.push(
        a === 'central'
          ? { requirement: 'Residencia de datos', status: 'fails', explanation: 'Centralizar exige sacar los historiales de cada hospital, lo que la normativa prohíbe.' }
          : a === 'dpstats'
            ? { requirement: 'Residencia de datos', status: 'partial', explanation: 'Cada hospital podría publicar estadísticas con DP sin mover datos, pero eso no produce el modelo predictivo que se necesita.' }
            : { requirement: 'Residencia de datos', status: 'meets', explanation: 'Los datos brutos permanecen en cada hospital; solo se intercambian parámetros del modelo.' },
      );
      // Precisión
      if (a === 'dpstats') out.push({ requirement: 'Precisión del modelo', status: 'fails', explanation: 'Publicar estadísticas agregadas no entrena un clasificador; no se alcanza el objetivo de predicción.' });
      else if (a === 'central' || a === 'fl' || c.noise === 'none')
        out.push({
          requirement: 'Precisión del modelo',
          status: c.epochs === 'many' && a !== 'central' ? 'partial' : 'meets',
          explanation:
            a === 'central'
              ? 'El entrenamiento centralizado es la referencia de precisión.'
              : c.epochs === 'many'
                ? 'Sin ruido FedAvg suele acercarse al centralizado, pero con muchas épocas locales y datos non-IID la deriva de clientes puede costar precisión.'
                : 'Sin ruido, FedAvg con pocos clientes y datos moderadamente heterogéneos suele acercarse al modelo centralizado.',
        });
      else if (c.unit === 'client')
        out.push({
          requirement: 'Precisión del modelo',
          status: c.noise === 'low' ? 'partial' : 'fails',
          explanation:
            'DP a nivel de cliente con solo 5 clientes es muy costosa: el ruido σ·C se divide únicamente entre 5 actualizaciones, y ocultar la participación de un hospital ENTERO exige mucho ruido. Es difícil mantenerse a 3 puntos del centralizado.',
        });
      else
        out.push({
          requirement: 'Precisión del modelo',
          status: c.noise === 'high' ? 'partial' : 'meets',
          explanation:
            c.noise === 'high'
              ? 'DP a nivel de registro con ruido alto (ε < 0,5) suele degradar notablemente la precisión incluso con 100 000 pacientes en total.'
              : 'DP a nivel de registro (DP-SGD en cada hospital) con decenas de miles de pacientes suele tolerar ε ≈ 1–10 con una pérdida de precisión moderada. Debe comprobarse empíricamente.',
        });
      // Privacidad
      if (!usesDP(a) || a === 'dpstats') {
        if (a === 'dpstats') out.push({ requirement: 'Garantía formal de privacidad', status: 'meets', explanation: 'Las estadísticas con Laplace tendrían garantía formal, pero no resuelven el problema de entrenar el modelo.' });
        else out.push(noDP(a));
      } else if (c.noise === 'none') out.push({ requirement: 'Garantía formal de privacidad', status: 'fails', explanation: 'Recortar sin añadir ruido no da DP: σ = 0 implica que no hay garantía.' });
      else
        out.push({
          requirement: 'Garantía formal de privacidad',
          status: c.noise === 'low' ? 'partial' : 'meets',
          explanation:
            (c.noise === 'low' ? 'Un ε ≈ 8–10 es formal pero débil frente al requisito (ε ≤ 4). ' : 'El rango de ε es compatible con el requisito si un contador válido lo confirma. ') +
            (c.unit === 'record'
              ? 'La unidad «paciente» es la que pide el requisito.'
              : 'La unidad «hospital» es más fuerte de lo exigido (protege a todos sus pacientes a la vez), a costa de mucha utilidad.'),
        });
      // Confianza en el servidor
      if (a === 'fldpsa')
        out.push({ requirement: 'Desconfianza en el operador del servidor', status: 'meets', explanation: 'Con agregación segura el operador solo ve la suma; el ruido distribuido evita depender de él para la DP.' });
      else if (a === 'fldp')
        out.push({ requirement: 'Desconfianza en el operador del servidor', status: 'partial', explanation: 'Con DP central el servidor recibe cada actualización sin ruido y es él quien añade el ruido: hay que confiar en él. Añade agregación segura o DP local.' });
      else if (a !== 'dpstats')
        out.push({ requirement: 'Desconfianza en el operador del servidor', status: 'fails', explanation: 'El servidor ve los datos (centralizado) o las actualizaciones individuales (FL), que pueden filtrar información.' });
      // Comunicación
      if (usesFL(a)) {
        const st: Status = c.participation === 'low' || c.epochs === 'few' ? 'partial' : 'meets';
        out.push({
          requirement: 'Comunicación y rondas',
          status: st,
          explanation:
            c.participation === 'low'
              ? 'Con 5 hospitales siempre disponibles no tiene sentido usar participación muy baja: cada ronda solo aprendería de 1 hospital y harían falta muchas más rondas.'
              : c.epochs === 'few'
                ? 'Con 1 época local se necesitan más rondas; con ancho de banda holgado es aceptable, pero no óptimo.'
                : 'Participación alta y varias épocas locales reducen el número de rondas; con pocos clientes y buena red, el coste es bajo.',
        });
      } else
        out.push({ requirement: 'Comunicación y rondas', status: 'meets', explanation: a === 'central' ? 'Se transfiere el conjunto de datos una vez (pero incumple la residencia).' : 'No hay entrenamiento iterativo.' });
      return out;
    },
    discussion: [
      'Respuesta razonable: FL + DP + agregación segura, con DP a nivel de REGISTRO (DP-SGD en cada hospital), ruido medio, participación total y épocas locales moderadas.',
      'FL + DP central también puede ser aceptable si existe un agregador de confianza (p. ej. un consorcio independiente o un entorno de ejecución confiable).',
      'DP a nivel de cliente con 5 clientes es casi siempre demasiado costosa: el ruido se promedia entre muy pocas actualizaciones.',
      'Ningún ε es «seguro» por sí mismo: debe justificarse frente a un modelo de amenazas y validarse empíricamente la precisión con datos de validación.',
    ],
  },
  {
    id: 'keyboard',
    name: 'TecladoListo',
    summary: 'Una empresa de teclados móviles quiere mejorar la predicción de la siguiente palabra con lo que escriben sus usuarios.',
    facts: [
      '≈ 5 millones de móviles; cada usuario es un cliente con su propio historial de escritura.',
      'Los dispositivos solo están disponibles cargando y con wifi; muchos abandonan a mitad de ronda.',
      'Datos móviles limitados y batería: el cómputo local debe ser contenido.',
    ],
    requirements: [
      { label: 'Residencia', kind: 'other', text: 'El texto tecleado no puede salir del dispositivo.' },
      { label: 'Privacidad', kind: 'privacy', text: 'Garantía formal que proteja TODO lo que escribe un usuario (no solo una frase), ε de un dígito a nivel de usuario.' },
      { label: 'Precisión', kind: 'accuracy', text: 'Una mejora moderada sobre el modelo actual es suficiente.' },
      { label: 'Comunicación', kind: 'communication', text: 'Pocos megabytes por dispositivo y día; imposible coordinar a todos los dispositivos a la vez.' },
    ],
    evaluate: (c) => {
      const a = c.architecture;
      const out: Evaluation[] = [];
      out.push(
        a === 'central'
          ? { requirement: 'Residencia de datos', status: 'fails', explanation: 'Subir todo lo que escriben los usuarios a un servidor incumple el requisito y concentra un riesgo enorme.' }
          : { requirement: 'Residencia de datos', status: 'meets', explanation: 'El texto permanece en el dispositivo.' },
      );
      // Privacidad
      if (a === 'dpstats') out.push({ requirement: 'Garantía formal de privacidad', status: 'partial', explanation: 'Se podrían publicar estadísticas con DP (p. ej. frecuencias de palabras), pero no es el modelo predictivo pedido y probablemente exigiría DP local con mucho ruido.' });
      else if (!usesDP(a)) out.push(noDP(a));
      else if (c.noise === 'none') out.push({ requirement: 'Garantía formal de privacidad', status: 'fails', explanation: 'Sin ruido no hay DP.' });
      else if (c.unit === 'record')
        out.push({
          requirement: 'Garantía formal de privacidad',
          status: 'partial',
          explanation: 'La unidad «registro» protege una frase o un ejemplo, pero un usuario aporta miles: la garantía para el usuario completo se degrada mucho. El requisito pide DP a nivel de usuario = cliente.',
        });
      else
        out.push({
          requirement: 'Garantía formal de privacidad',
          status: 'meets',
          explanation: 'DP a nivel de cliente protege todo el historial de cada usuario. Con participación parcial, un ε ajustado debe calcularse con un contador que incluya el muestreo de clientes (amplificación), no implementado en este laboratorio: con vecindad añadir/eliminar allí aparece «No calculado», y con vecindad por reemplazo solo se obtiene una cota conservadora (peor caso: el cliente participa en todas las rondas, Δ₂ = 2C).',
        });
      // Precisión
      if (a === 'dpstats') out.push({ requirement: 'Precisión', status: 'fails', explanation: 'No se entrena un modelo de predicción.' });
      else if (!usesDP(a) || c.noise === 'none') out.push({ requirement: 'Precisión', status: 'meets', explanation: 'Sin ruido la precisión no se ve afectada por la privacidad.' });
      else
        out.push({
          requirement: 'Precisión',
          status: c.noise === 'high' ? 'partial' : 'meets',
          explanation:
            c.noise === 'high'
              ? 'Ruido muy alto puede anular la mejora, aunque el gran número de clientes ayuda.'
              : 'Con miles de clientes por ronda, el ruido σ·C se divide entre muchas actualizaciones: la DP a nivel de usuario tiene un coste de utilidad moderado. Este es el régimen donde DP-FedAvg funciona mejor.',
        });
      // Confianza
      if (a === 'fldpsa') out.push({ requirement: 'Exposición de actualizaciones individuales', status: 'meets', explanation: 'La agregación segura impide que el servidor vea la actualización de un usuario concreto.' });
      else if (a === 'fldp') out.push({ requirement: 'Exposición de actualizaciones individuales', status: 'partial', explanation: 'El servidor ve cada actualización antes de añadir ruido; un fallo o abuso en el servidor expone a los usuarios.' });
      else if (a === 'fl') out.push({ requirement: 'Exposición de actualizaciones individuales', status: 'fails', explanation: 'El servidor ve cada actualización sin protección.' });
      // Comunicación
      if (a === 'central') out.push({ requirement: 'Comunicación', status: 'fails', explanation: 'Subir continuamente el texto de millones de usuarios es costoso e incumple el requisito de residencia.' });
      else if (a === 'dpstats') out.push({ requirement: 'Comunicación', status: 'meets', explanation: 'Enviar estadísticas locales es barato.' });
      else {
        if (c.participation === 'full')
          out.push({ requirement: 'Comunicación y disponibilidad', status: 'fails', explanation: 'Es imposible que 5 millones de dispositivos intermitentes participen en todas las rondas.' });
        else if (c.participation === 'medium')
          out.push({ requirement: 'Comunicación y disponibilidad', status: 'partial', explanation: 'Coordinar a millones de dispositivos en cada ronda no es realista; los sistemas reales seleccionan unos cientos o miles por ronda.' });
        else
          out.push({
            requirement: 'Comunicación y disponibilidad',
            status: c.epochs === 'many' ? 'partial' : 'meets',
            explanation:
              c.epochs === 'many'
                ? 'Participación baja es correcta, pero muchas épocas locales consumen batería y aumentan la deriva con datos de usuarios muy heterogéneos.'
                : 'Seleccionar una pequeña fracción de dispositivos por ronda respeta la disponibilidad y limita los datos por dispositivo.' + (c.epochs === 'few' ? ' Con 1 época local hacen falta más rondas; es aceptable.' : ''),
          });
      }
      return out;
    },
    discussion: [
      'Respuesta razonable: FL + DP + agregación segura, DP a nivel de CLIENTE (usuario), ruido bajo o medio, participación baja (muestreo de clientes) y pocas o moderadas épocas locales.',
      'Es el escenario en el que DP-FedAvg se usa en la práctica: muchos clientes hacen que el ruido por actualización media sea pequeño.',
      'Con participación parcial, el ε ajustado depende de la amplificación por submuestreo y requiere un contador específico. Con vecindad añadir/eliminar el laboratorio muestra «No calculado» en lugar de inventar un número; con reemplazo da una cota conservadora sin amplificación, mucho mayor que el ε real.',
      'La agregación segura real debe tolerar abandonos de dispositivos: aquí solo se ilustra conceptualmente.',
    ],
  },
  {
    id: 'agency',
    name: 'Instituto Estadístico de Valdemar',
    summary: 'Una agencia estadística publica tablas de conteos de población por región a partir de un censo que ya posee legalmente.',
    facts: [
      'El censo está almacenado en la propia agencia (ya es un sistema centralizado).',
      'Cada año se publican ≈ 10 tablas de conteos en las que cada persona aparece en una celda de cada tabla.',
      'Los conteos típicos son de miles de personas por celda.',
    ],
    requirements: [
      { label: 'Producto', kind: 'other', text: 'Tablas de conteos publicadas; no se necesita un modelo de ML.' },
      { label: 'Privacidad', kind: 'privacy', text: 'Garantía formal por persona con un presupuesto anual total ε_total ≈ 1 para todas las tablas.' },
      { label: 'Precisión', kind: 'accuracy', text: 'Error típico de ± 20 personas por celda como máximo.' },
      { label: 'Comunicación', kind: 'communication', text: 'No hay restricción: todo ocurre dentro de la agencia.' },
    ],
    evaluate: (c) => {
      const a = c.architecture;
      const out: Evaluation[] = [];
      if (usesFL(a))
        out.push({ requirement: 'Adecuación de la arquitectura', status: 'fails', explanation: 'Los datos ya están centralizados de forma legal y no se entrena un modelo: el aprendizaje federado añade complejidad sin resolver el problema de publicar tablas.' });
      else if (a === 'central')
        out.push({ requirement: 'Adecuación de la arquitectura', status: 'partial', explanation: 'Calcular las tablas de forma centralizada es correcto, pero publicar conteos EXACTOS permite ataques de diferenciación y reconstrucción.' });
      else out.push({ requirement: 'Adecuación de la arquitectura', status: 'meets', explanation: 'Publicar conteos con el mecanismo de Laplace es exactamente el caso de uso clásico de la DP.' });
      // Privacidad
      if (a !== 'dpstats') {
        if (a === 'fldp' || a === 'fldpsa') out.push({ requirement: 'Garantía formal por persona', status: 'partial', explanation: 'DP en un entrenamiento federado protegería un modelo, no las tablas publicadas.' });
        else out.push(noDP(a));
      } else if (c.noise === 'none') out.push({ requirement: 'Garantía formal por persona', status: 'fails', explanation: 'Sin ruido los conteos se publican exactos.' });
      else
        out.push({
          requirement: 'Garantía formal por persona',
          status: c.noise === 'low' ? 'fails' : c.unit === 'client' ? 'partial' : 'meets',
          explanation:
            c.noise === 'low'
              ? 'ε ≈ 8–10 por tabla × 10 tablas (composición secuencial) supera con mucho el presupuesto anual ε_total ≈ 1.'
              : c.unit === 'client'
                ? 'Aquí no hay «clientes»; si interpretas la unidad como un hogar, la garantía es más fuerte pero exige más ruido. El requisito pide protección por persona.'
                : 'Unidad «persona» y ruido calibrado; recuerda que las 10 tablas componen: hay que repartir ε_total entre ellas.',
        });
      // Precisión
      if (a !== 'dpstats') out.push({ requirement: 'Error por celda', status: a === 'central' ? 'meets' : 'fails', explanation: a === 'central' ? 'Los conteos exactos tienen error 0 (pero sin privacidad).' : 'No se producen las tablas pedidas.' });
      else if (c.noise === 'none' || c.noise === 'low') out.push({ requirement: 'Error por celda', status: 'meets', explanation: 'Poco ruido: el error es pequeño (pero la privacidad no cumple).' });
      else if (c.noise === 'medium')
        out.push({
          requirement: 'Error por celda',
          status: 'meets',
          explanation: `Con ε_total = 1 repartido en 10 tablas, cada tabla usa ε = 0,1: b = Δ/ε = ${fmt(AGENCY_B_MEDIUM)} y el error absoluto medio por celda es ≈ ${fmt(AGENCY_B_MEDIUM)} personas, dentro de ± 20.`,
        });
      else
        out.push({
          requirement: 'Error por celda',
          status: 'fails',
          explanation: `Con ε_total = 0,2 repartido en 10 tablas (ε = 0,02 por tabla), b = ${fmt(AGENCY_B_HIGH)}: el error medio por celda (≈ ${fmt(AGENCY_B_HIGH)}) supera el límite de ± 20.`,
        });
      out.push({
        requirement: 'Comunicación',
        status: usesFL(a) ? 'partial' : 'meets',
        explanation: usesFL(a) ? 'Introduce rondas de comunicación innecesarias.' : 'Sin restricciones de comunicación.',
      });
      return out;
    },
    discussion: [
      'Respuesta razonable: DP sobre estadísticas publicadas (mecanismo de Laplace), unidad = persona, presupuesto ε_total ≈ 1 repartido entre las tablas (composición secuencial).',
      'Si las celdas de una misma tabla son disjuntas (cada persona está en una sola celda), toda la tabla cuesta un solo ε (composición paralela); por eso el reparto es entre tablas, no entre celdas.',
      'El error ABSOLUTO es el mismo para celdas grandes y pequeñas; en celdas pequeñas el error RELATIVO es grande. Las agencias reales usan además posprocesamiento (no negatividad, coherencia entre tablas).',
      'El aprendizaje federado no aporta nada cuando los datos ya están legalmente centralizados y el producto es una tabla, no un modelo.',
    ],
  },
];

export interface ChallengeState {
  choices: Record<string, ChallengeChoice>;
  submitted: Record<string, boolean>;
}
export const EMPTY_CHALLENGE: ChallengeState = { choices: {}, submitted: {} };

export function verdict(evals: Evaluation[]): { label: string; status: Status } {
  if (evals.some((e) => e.status === 'fails')) return { label: 'No cumple todos los requisitos', status: 'fails' };
  if (evals.some((e) => e.status === 'partial')) return { label: 'Cumple parcialmente: revisa los compromisos', status: 'partial' };
  return { label: 'Configuración adecuada para los requisitos', status: 'meets' };
}

export function settingsRelevance(a: Architecture | null) {
  return { dp: usesDP(a), fl: usesFL(a) };
}
