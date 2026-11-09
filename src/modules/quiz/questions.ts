/**
 * Preguntas de comprobación de conocimientos por módulo.
 * Los valores numéricos de las preguntas "calculadas" se obtienen con las mismas
 * funciones del motor que usan los experimentos (no están escritos a mano).
 */
import { laplaceScale } from '@/lib/dp/laplace';
import { gaussianCompositionEpsilon } from '@/lib/dp/accountant';
import { weightedAverage } from '@/lib/fl/fedavg';
import { estimateCommunication, formatBytes } from '@/lib/fl/communication';
import { boundedMeanSensitivity } from '@/lib/dp/sensitivity';

export type QuizModule = 'dp' | 'fl' | 'combined';

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
  /** Por qué esta opción es correcta o incorrecta. */
  explanation: string;
}

export interface QuizQuestion {
  id: string;
  /** Concepto evaluado (etiqueta corta). */
  concept: string;
  prompt: string;
  /** Contexto o datos del problema (opcional). */
  context?: string;
  /** true si incluye valores calculados con el motor del laboratorio. */
  computed?: boolean;
  options: QuizOption[];
  learnMore: { label: string; path: string }[];
}

const fmt = (x: number, d = 3) => x.toLocaleString('es-ES', { maximumFractionDigits: d });

// ---------- Valores calculados ----------
const B_Q2 = laplaceScale(2, 0.5); // = 4
const MEAN_SENS = boundedMeanSensitivity(0, 100, 50).value; // = 2
const FEDAVG = weightedAverage([[0.2], [0.6]], [100, 300]); // = 0.5
const COMM = estimateCommunication({ numParams: 3, numClients: 10, participation: 0.5, rounds: 20 }); // 2400 B
const EPS_S1 = gaussianCompositionEpsilon({ noiseMultiplier: 1, steps: 20, delta: 1e-3 }).epsilon;
const EPS_S2 = gaussianCompositionEpsilon({ noiseMultiplier: 2, steps: 20, delta: 1e-3 }).epsilon;

export const QUESTIONS: Record<QuizModule, QuizQuestion[]> = {
  dp: [
    {
      id: 'dp-q1',
      concept: 'ε y escala de ruido',
      prompt: 'Si disminuimos ε manteniendo la misma sensibilidad de la consulta, ¿qué ocurre con la escala del ruido de Laplace?',
      options: [
        {
          id: 'a',
          text: 'Aumenta: b = Δ/ε, así que un ε menor produce más ruido.',
          correct: true,
          explanation: 'Correcto. La escala es inversamente proporcional a ε. Pasar de ε = 1 a ε = 0,1 multiplica b (y el error absoluto medio esperado, que es b) por 10. Es el precio de una garantía más fuerte.',
        },
        {
          id: 'b',
          text: 'Disminuye: un ε menor significa menos ruido.',
          correct: false,
          explanation: 'Incorrecto. Es al revés: ε pequeño = privacidad fuerte = ruido grande. Un ε menor obliga a que las distribuciones de salida en conjuntos vecinos sean más parecidas, lo que exige más ruido.',
        },
        {
          id: 'c',
          text: 'No cambia: la escala solo depende de la sensibilidad.',
          correct: false,
          explanation: 'Incorrecto. La sensibilidad Δ fija cuánto puede cambiar la respuesta exacta, pero la escala depende de Δ y de ε a la vez: b = Δ/ε.',
        },
        {
          id: 'd',
          text: 'Depende del tamaño del conjunto de datos.',
          correct: false,
          explanation: 'Incorrecto para un conteo. La escala b = Δ/ε no depende de n. Lo que sí depende de n es el error RELATIVO: el mismo ruido pesa menos sobre un conteo de 10 000 que sobre uno de 10.',
        },
      ],
      learnMore: [
        { label: 'Experimento 2 — Mecanismo de Laplace', path: '/dp/2' },
        { label: 'Experimento 3 — Privacidad vs utilidad', path: '/dp/3' },
      ],
    },
    {
      id: 'dp-q2',
      concept: 'Calibrar el mecanismo',
      computed: true,
      prompt: `Una consulta tiene sensibilidad Δ = 2 y quieres publicarla con ε = 0,5 usando el mecanismo de Laplace. ¿Cuál es la escala b y cuál es el error absoluto medio esperado?`,
      options: [
        {
          id: 'a',
          text: 'b = 1 y error medio ≈ 1.',
          correct: false,
          explanation: `Incorrecto. b = 1 sería Δ·ε = 2·0,5. La escala se obtiene dividiendo: b = Δ/ε = ${fmt(B_Q2)}.`,
        },
        {
          id: 'b',
          text: 'b = 0,25 y error medio ≈ 0,25.',
          correct: false,
          explanation: `Incorrecto. 0,25 = ε/Δ, la relación invertida. Con más sensibilidad o menos ε debe haber MÁS ruido, no menos: b = ${fmt(B_Q2)}.`,
        },
        {
          id: 'c',
          text: `b = ${fmt(B_Q2)} y error medio ≈ ${fmt(B_Q2)}.`,
          correct: true,
          explanation: `Correcto. b = Δ/ε = 2/0,5 = ${fmt(B_Q2)}. Para Laplace(0, b), E|ruido| = b, así que el error absoluto medio esperado también es ${fmt(B_Q2)} (y la desviación típica es √2·b ≈ ${fmt(Math.SQRT2 * B_Q2)}).`,
        },
        {
          id: 'd',
          text: `b = ${fmt(B_Q2)} pero el error medio es 0, porque el ruido tiene media cero.`,
          correct: false,
          explanation: 'Incorrecto. La media del ruido (con signo) es 0, por lo que el mecanismo es insesgado, pero cada publicación tiene un error ABSOLUTO cuyo valor esperado es b. No confundas sesgo con error.',
        },
      ],
      learnMore: [{ label: 'Experimento 2 — Mecanismo de Laplace', path: '/dp/2' }],
    },
    {
      id: 'dp-q3',
      concept: 'Sensibilidad de una media',
      computed: true,
      prompt: 'Quieres publicar la edad media de n = 50 personas (n público). Recortas las edades al intervalo público [0, 100]. Con vecindad por reemplazo, ¿cuál es la sensibilidad de la media?',
      options: [
        {
          id: 'a',
          text: '1, como en un conteo.',
          correct: false,
          explanation: 'Incorrecto. Un conteo cambia como mucho en 1 porque cada persona aporta 0 o 1. En una media, una persona puede mover su valor dentro de todo el intervalo [L, U], y ese cambio se reparte entre n.',
        },
        {
          id: 'b',
          text: `(U − L)/n = ${fmt(MEAN_SENS)}.`,
          correct: true,
          explanation: `Correcto. Al reemplazar a una persona, su valor recortado puede pasar de 0 a 100, lo que cambia la suma como mucho en 100 y la media en 100/50 = ${fmt(MEAN_SENS)}. Esto solo es válido porque los límites son públicos, se aplican antes de calcular y n no cambia.`,
        },
        {
          id: 'c',
          text: '100, el ancho del intervalo.',
          correct: false,
          explanation: 'Incorrecto. U − L es la sensibilidad de la SUMA bajo reemplazo. La media divide la suma entre n, así que la sensibilidad se divide también entre n.',
        },
        {
          id: 'd',
          text: 'La diferencia entre la edad máxima y mínima observadas en los datos.',
          correct: false,
          explanation: 'Incorrecto y peligroso. Si los límites se calculan a partir de los datos, ellos mismos revelan información (p. ej. la edad del mayor). Los límites deben ser públicos e independientes de los datos, o calcularse con una parte del presupuesto.',
        },
      ],
      learnMore: [{ label: 'Experimento 3 — Privacidad vs utilidad (sensibilidad)', path: '/dp/3' }],
    },
    {
      id: 'dp-q4',
      concept: 'Composición',
      prompt: '¿Pueden varias consultas privadas repetidas consumir más presupuesto de privacidad que una sola consulta?',
      options: [
        {
          id: 'a',
          text: 'No: cada consulta es ε-DP, así que el conjunto también es ε-DP.',
          correct: false,
          explanation: 'Incorrecto. Si repites k veces la misma consulta con ε, un analista puede promediar las respuestas y reducir el ruido aproximadamente en un factor √k. Por composición secuencial, el coste total es k·ε.',
        },
        {
          id: 'b',
          text: 'Sí: por composición secuencial, k consultas con ε₁, …, ε_k sobre los mismos datos cuestan como mucho ε₁ + … + ε_k.',
          correct: true,
          explanation: 'Correcto. Es la razón de tener un presupuesto total y un registro de gasto. Existen teoremas de composición más ajustados (avanzada, RDP), pero en todos la pérdida total crece con el número de consultas.',
        },
        {
          id: 'c',
          text: 'Solo si las consultas usan la misma semilla aleatoria; con semillas distintas el presupuesto se repone.',
          correct: false,
          explanation: 'Incorrecto. Cambiar la semilla produce ruido distinto, que es justo lo que permite promediarlo. La semilla del laboratorio es una herramienta de reproducibilidad; nunca repone presupuesto.',
        },
        {
          id: 'd',
          text: 'Solo si las consultas son diferentes; repetir exactamente la misma consulta no cuesta nada extra.',
          correct: false,
          explanation: 'Incorrecto. Repetir la misma consulta es el caso más claro de pérdida: el promedio de las publicaciones converge al valor real. (Si se reutilizara la MISMA respuesta publicada, en cambio, no habría coste adicional: es posprocesamiento).',
        },
      ],
      learnMore: [{ label: 'Experimento 4 — Presupuesto ε', path: '/dp/4' }],
    },
    {
      id: 'dp-q5',
      concept: 'Recorte en DP-SGD',
      prompt: 'En DP-SGD, ¿por qué se recorta (clipping) el gradiente de cada ejemplo a una norma máxima C antes de añadir ruido?',
      options: [
        {
          id: 'a',
          text: 'Para acelerar la convergencia del entrenamiento.',
          correct: false,
          explanation: 'Incorrecto. El recorte suele ralentizar o sesgar el entrenamiento, sobre todo si C es pequeño. No se usa por eficiencia sino por privacidad.',
        },
        {
          id: 'b',
          text: 'Para acotar la influencia de cada ejemplo (la sensibilidad de la suma es C), de modo que el ruido N(0, σ²C²) pueda calibrarse.',
          correct: true,
          explanation: 'Correcto. Sin recorte, un único ejemplo atípico podría tener un gradiente arbitrariamente grande y ninguna cantidad finita de ruido lo ocultaría. Con recorte, añadir o quitar un ejemplo cambia la suma como mucho en C.',
        },
        {
          id: 'c',
          text: 'Porque el recorte por sí solo ya garantiza privacidad diferencial.',
          correct: false,
          explanation: 'Incorrecto. El recorte acota la sensibilidad, pero es determinista: sin ruido no hay DP. Con σ = 0 el laboratorio muestra «No calculado».',
        },
        {
          id: 'd',
          text: 'Para que el valor de ε pueda calcularse sin un contador de privacidad.',
          correct: false,
          explanation: 'Incorrecto. Incluso con recorte y ruido, el ε total de muchos pasos requiere un contador (p. ej. RDP). Por eso el laboratorio solo muestra ε cuando la contabilidad implementada es válida (lote completo).',
        },
      ],
      learnMore: [{ label: 'Experimento 5 — DP-SGD', path: '/dp/5' }],
    },
  ],
  fl: [
    {
      id: 'fl-q1',
      concept: 'Privacidad en FL',
      prompt: '¿Garantiza el aprendizaje federado que el servidor no pueda inferir información sobre los registros de entrenamiento individuales?',
      options: [
        {
          id: 'a',
          text: 'Sí, porque los datos brutos nunca salen de los clientes.',
          correct: false,
          explanation: 'Incorrecto. «Los datos permanecen locales» no implica «el servidor no puede inferir nada». Las actualizaciones son funciones de los datos: en el Experimento 5 verás que, con un solo ejemplo, el gradiente de una regresión logística revela la entrada exacta (x = g_w/g_b).',
        },
        {
          id: 'b',
          text: 'No: las actualizaciones del modelo pueden filtrar información sobre los datos locales; FL reduce la exposición de datos brutos pero no ofrece una garantía formal.',
          correct: true,
          explanation: 'Correcto. FL es minimización de datos, no una garantía de privacidad. Para acotar la inferencia hacen falta mecanismos adicionales: DP (acota lo que revela cualquier salida), agregación segura (oculta actualizaciones individuales) y controles de acceso.',
        },
        {
          id: 'c',
          text: 'Sí, siempre que se usen muchas épocas locales.',
          correct: false,
          explanation: 'Incorrecto. Más épocas locales mezclan más ejemplos en la actualización y pueden dificultar algunas reconstrucciones, pero no ofrecen ninguna garantía; la actualización sigue dependiendo de los datos.',
        },
        {
          id: 'd',
          text: 'Solo si el servidor es honesto; un servidor curioso no puede aprender nada útil.',
          correct: false,
          explanation: 'Incorrecto. Precisamente un servidor «honesto pero curioso» que sigue el protocolo puede analizar las actualizaciones que recibe. El modelo de amenazas importa.',
        },
      ],
      learnMore: [
        { label: 'Experimento 1 — Centralizado vs federado', path: '/fl/1' },
        { label: 'Experimento 5 — Fugas en actualizaciones', path: '/fl/5' },
      ],
    },
    {
      id: 'fl-q2',
      concept: 'Datos heterogéneos',
      prompt: '¿Por qué puede costarle a un modelo federado aprender cuando los clientes tienen datos muy heterogéneos (non-IID)?',
      options: [
        {
          id: 'a',
          text: 'Porque FedAvg no puede ejecutarse si los clientes tienen distinta proporción de clases.',
          correct: false,
          explanation: 'Incorrecto. FedAvg funciona con cualquier distribución; la cuestión es la calidad y la velocidad de convergencia, no si se puede ejecutar.',
        },
        {
          id: 'b',
          text: 'Porque cada cliente optimiza hacia su propio óptimo local (deriva de clientes); al promediar, el modelo puede oscilar o converger más despacio hacia un compromiso peor.',
          correct: true,
          explanation: 'Correcto. Con muchas épocas locales sobre datos sesgados, los modelos locales se alejan entre sí y de la solución global. Aun así, no siempre empeora en cada ejecución: depende del grado de heterogeneidad, la configuración y el azar (compruébalo en el Experimento 3).',
        },
        {
          id: 'c',
          text: 'Porque los datos non-IID siempre producen peor precisión que los IID.',
          correct: false,
          explanation: 'Incorrecto por absoluto. Es una tendencia frecuente, no una ley: con poca heterogeneidad, pocas épocas locales o un modelo sencillo, la diferencia puede ser nula o incluso favorable en alguna ejecución.',
        },
        {
          id: 'd',
          text: 'Porque los clientes non-IID envían más bytes por ronda.',
          correct: false,
          explanation: 'Incorrecto. El tamaño de la actualización depende del número de parámetros, no de la distribución de los datos. Lo que puede aumentar es el número de RONDAS necesarias.',
        },
      ],
      learnMore: [{ label: 'Experimento 3 — IID vs Non-IID', path: '/fl/3' }],
    },
    {
      id: 'fl-q3',
      concept: 'Agregación FedAvg',
      computed: true,
      prompt: 'Dos hospitales participan en una ronda. El Hospital Norte tiene 100 muestras y su parámetro local es w = 0,2; el Hospital Sur tiene 300 muestras y w = 0,6. ¿Cuál es el parámetro global según FedAvg?',
      context: 'w_global = Σ (n_k / N) · w_k, con N la suma de muestras de los participantes.',
      options: [
        {
          id: 'a',
          text: '0,4 (media simple).',
          correct: false,
          explanation: 'Incorrecto. 0,4 es la media sin ponderar. FedAvg pondera por número de muestras para que el resultado se parezca al entrenamiento sobre los datos combinados.',
        },
        {
          id: 'b',
          text: `${fmt(FEDAVG.params[0])}.`,
          correct: true,
          explanation: `Correcto. N = 400; pesos = 100/400 = ${fmt(FEDAVG.weights[0])} y 300/400 = ${fmt(FEDAVG.weights[1])}. w = ${fmt(FEDAVG.weights[0])}·0,2 + ${fmt(FEDAVG.weights[1])}·0,6 = ${fmt(FEDAVG.params[0])}.`,
        },
        {
          id: 'c',
          text: '0,8 (suma de los parámetros).',
          correct: false,
          explanation: 'Incorrecto. Sumar los modelos no tiene sentido: los pesos de la media deben sumar 1.',
        },
        {
          id: 'd',
          text: '0,3 (se da más peso al cliente pequeño para compensar).',
          correct: false,
          explanation: 'Incorrecto. FedAvg estándar da más peso a quien tiene más datos. Existen variantes que reponderan por equidad, pero no es la regla de FedAvg.',
        },
      ],
      learnMore: [{ label: 'Experimento 2 — Ronda FedAvg', path: '/fl/2' }],
    },
    {
      id: 'fl-q4',
      concept: 'Coste de comunicación',
      computed: true,
      prompt: 'Un modelo de 3 parámetros (float32) se entrena con 10 clientes, participación del 50 % y 20 rondas. Contando solo la carga útil (bajada + subida de parámetros), ¿cuánto se transmite en total?',
      options: [
        {
          id: 'a',
          text: formatBytes(3 * 4 * 20),
          correct: false,
          explanation: 'Incorrecto. Eso sería un único modelo enviado una vez por ronda. Cada ronda, cada cliente seleccionado DESCARGA el modelo global y SUBE su actualización.',
        },
        {
          id: 'b',
          text: formatBytes(2 * 10 * 3 * 4 * 20),
          correct: false,
          explanation: 'Incorrecto. Supone que participan los 10 clientes. Con 50 % de participación solo se seleccionan 5 por ronda.',
        },
        {
          id: 'c',
          text: formatBytes(COMM.total),
          correct: true,
          explanation: `Correcto. Por ronda: ${COMM.clientsPerRound} clientes × 3 parámetros × 4 bytes × 2 (bajada + subida) = ${formatBytes(COMM.perRound)}; por 20 rondas = ${formatBytes(COMM.total)}. Con un modelo de millones de parámetros, el mismo cálculo da gigabytes: por eso la comunicación es un coste central en FL. (Modelo simplificado: sin cabeceras, cifrado ni compresión).`,
        },
        {
          id: 'd',
          text: 'Nada: en FL no se transmite información.',
          correct: false,
          explanation: 'Incorrecto. FL evita transmitir datos brutos, pero transmite modelos y actualizaciones en cada ronda.',
        },
      ],
      learnMore: [{ label: 'Experimento 4 — Comunicación', path: '/fl/4' }],
    },
    {
      id: 'fl-q5',
      concept: 'Cómputo local vs comunicación',
      prompt: 'Aumentas las épocas locales de 1 a 20 manteniendo todo lo demás. ¿Qué efecto es más plausible?',
      options: [
        {
          id: 'a',
          text: 'Más cómputo por ronda y posiblemente menos rondas para una precisión dada; pero con datos non-IID aumenta la deriva de clientes y el beneficio puede desaparecer.',
          correct: true,
          explanation: 'Correcto. Es el compromiso central de FedAvg: cambiar comunicación por cómputo local. Con datos IID suele compensar; con datos heterogéneos, demasiadas épocas locales alejan los modelos del óptimo global.',
        },
        {
          id: 'b',
          text: 'Menos bytes por ronda, porque las actualizaciones son más pequeñas.',
          correct: false,
          explanation: 'Incorrecto. Los bytes por ronda dependen del número de parámetros y de clientes, no de las épocas locales. Lo que puede reducirse es el número de rondas.',
        },
        {
          id: 'c',
          text: 'Siempre mejor precisión final, porque se entrena más.',
          correct: false,
          explanation: 'Incorrecto. Entrenar más localmente no equivale a entrenar mejor el modelo global, sobre todo con datos heterogéneos.',
        },
        {
          id: 'd',
          text: 'Mayor privacidad, porque las actualizaciones mezclan más pasos.',
          correct: false,
          explanation: 'Incorrecto. Sin un mecanismo de DP no hay garantía; más pasos locales no acotan formalmente lo que revela la actualización.',
        },
      ],
      learnMore: [
        { label: 'Experimento 4 — Comunicación', path: '/fl/4' },
        { label: 'Experimento 3 — IID vs Non-IID', path: '/fl/3' },
      ],
    },
  ],
  combined: [
    {
      id: 'c-q1',
      concept: 'Unidad de privacidad',
      prompt: '¿Cuál es la diferencia entre una garantía de privacidad para un registro individual y una para un cliente completo?',
      options: [
        {
          id: 'a',
          text: 'Ninguna: ambas protegen a los pacientes por igual.',
          correct: false,
          explanation: 'Incorrecto. Cambia la definición de conjuntos vecinos y, con ella, la sensibilidad y el ruido necesario.',
        },
        {
          id: 'b',
          text: 'A nivel de registro, los vecinos difieren en un ejemplo; a nivel de cliente, difieren en TODOS los datos de un cliente. La de cliente es más fuerte y suele requerir recortar la actualización entera del cliente.',
          correct: true,
          explanation: 'Correcto. DP de registro (p. ej. DP-SGD local) protege a cada paciente, pero no oculta propiedades de un hospital entero. DP de cliente (DP-FedAvg, el que implementa este laboratorio) oculta la participación de cada cliente, lo que también protege a cada registro de ese cliente; es la adecuada cuando cada cliente es una persona (p. ej. un móvil).',
        },
        {
          id: 'c',
          text: 'La garantía a nivel de registro es siempre más fuerte porque es más fina.',
          correct: false,
          explanation: 'Incorrecto. «Más fina» no es «más fuerte»: proteger a un registro con ε no impide aprender mucho de un cliente con miles de registros.',
        },
        {
          id: 'd',
          text: 'La de cliente no requiere ruido porque los datos ya están distribuidos.',
          correct: false,
          explanation: 'Incorrecto. La distribución no es un mecanismo de privacidad; cualquier garantía de DP requiere aleatoriedad calibrada.',
        },
      ],
      learnMore: [{ label: 'Experimento combinado — FL + DP', path: '/combined' }],
    },
    {
      id: 'c-q2',
      concept: 'Agregación segura',
      prompt: 'Combinas DP-FedAvg (ruido añadido por el servidor) con agregación segura. ¿Qué afirmación es correcta?',
      options: [
        {
          id: 'a',
          text: 'La agregación segura hace innecesario el ruido de DP.',
          correct: false,
          explanation: 'Incorrecto. La agregación segura oculta las actualizaciones individuales, pero la SUMA y el modelo final siguen pudiendo revelar información; solo la DP acota lo que revelan.',
        },
        {
          id: 'b',
          text: 'La agregación segura oculta al servidor cada actualización individual; la DP acota lo que revelan la suma y el modelo publicado. Si el servidor solo ve la suma, el ruido debe añadirse de forma distribuida o antes de la agregación.',
          correct: true,
          explanation: 'Correcto. Son defensas complementarias con modelos de amenaza distintos. En el laboratorio el ruido lo añade un servidor de confianza (DP central); con agregación segura real habría que repartir el ruido entre clientes. La agregación segura solo se muestra conceptualmente.',
        },
        {
          id: 'c',
          text: 'La agregación segura cifra el modelo final para que nadie pueda usarlo.',
          correct: false,
          explanation: 'Incorrecto. El modelo agregado se publica en claro; la agregación segura protege los valores intermedios durante la agregación.',
        },
        {
          id: 'd',
          text: 'La agregación segura protege frente a clientes maliciosos que envían actualizaciones envenenadas.',
          correct: false,
          explanation: 'Incorrecto. Al ocultar las actualizaciones, la agregación segura puede incluso DIFICULTAR detectar envenenamiento. La robustez es un problema distinto.',
        },
      ],
      learnMore: [
        { label: 'Experimento 5 (FL) — Defensas', path: '/fl/5' },
        { label: 'Experimento combinado', path: '/combined' },
      ],
    },
    {
      id: 'c-q3',
      concept: 'Contabilidad de privacidad',
      computed: true,
      prompt: `Con participación del 100 %, 20 rondas y δ = 10⁻³, el contador RDP del laboratorio da ε ≈ ${fmt(EPS_S1, 2)} para σ = 1 y ε ≈ ${fmt(EPS_S2, 2)} para σ = 2. Si bajas la participación al 30 %, el laboratorio muestra «No calculado». ¿Por qué?`,
      options: [
        {
          id: 'a',
          text: 'Porque con participación parcial no hay privacidad.',
          correct: false,
          explanation: 'Incorrecto. El muestreo de clientes normalmente MEJORA la privacidad (amplificación por submuestreo). «No calculado» indica falta de un contador implementado, no ausencia de privacidad.',
        },
        {
          id: 'b',
          text: 'Porque la cota válida exige contabilizar el muestreo de clientes con un contador específico que no está implementado; el laboratorio prefiere no inventar un ε.',
          correct: true,
          explanation: 'Correcto. La integridad exige mostrar solo valores con un método válido. El contador implementado (RDP gaussiano sin submuestreo) solo es aplicable cuando todos los clientes participan en todas las rondas.',
        },
        {
          id: 'c',
          text: 'Porque ε solo depende de σ, y σ no ha cambiado.',
          correct: false,
          explanation: 'Incorrecto. ε depende de σ, del número de pasos, de δ y del esquema de muestreo. Cambiar la participación cambia el mecanismo.',
        },
        {
          id: 'd',
          text: 'Porque ε sería exactamente 0,3 veces el valor con participación total.',
          correct: false,
          explanation: 'Incorrecto. La amplificación por submuestreo no es una regla lineal tan simple; requiere un análisis específico.',
        },
      ],
      learnMore: [{ label: 'Experimento combinado — FL + DP', path: '/combined' }],
    },
    {
      id: 'c-q4',
      concept: 'Compromiso privacidad–utilidad',
      prompt: 'En DP-FedAvg, ¿qué efecto tiene aumentar el multiplicador de ruido σ manteniendo C?',
      options: [
        {
          id: 'a',
          text: `Disminuye ε (más privacidad; p. ej. ${fmt(EPS_S1, 2)} → ${fmt(EPS_S2, 2)} al pasar de σ = 1 a σ = 2) y, en general, reduce la precisión porque el ruido N(0, (σC)²) perturba más la actualización global.`,
          correct: true,
          explanation: 'Correcto. Es el compromiso privacidad–utilidad. Cuánto se degrada la precisión depende de cuántos clientes participan: el ruido se divide entre m, así que con muchos clientes el mismo σ cuesta menos utilidad.',
        },
        {
          id: 'b',
          text: 'Aumenta ε y la precisión.',
          correct: false,
          explanation: 'Incorrecto. Más ruido implica una garantía más fuerte (ε menor), no más débil.',
        },
        {
          id: 'c',
          text: 'No afecta a la privacidad porque el recorte ya la garantiza.',
          correct: false,
          explanation: 'Incorrecto. El recorte acota la sensibilidad; es el ruido calibrado a esa sensibilidad lo que produce la garantía.',
        },
        {
          id: 'd',
          text: 'Reduce los bytes transmitidos.',
          correct: false,
          explanation: 'Incorrecto. El ruido se añade a los valores; no cambia el número de parámetros transmitidos.',
        },
      ],
      learnMore: [{ label: 'Experimento combinado — barrido σ y C', path: '/combined' }],
    },
    {
      id: 'c-q5',
      concept: 'Norma de recorte',
      prompt: 'Al elegir la norma de recorte C en DP-FedAvg (con σ fijo), ¿qué compromiso aparece?',
      options: [
        {
          id: 'a',
          text: 'C muy pequeño recorta casi todas las actualizaciones (sesgo, aprendizaje lento); C muy grande aumenta el ruido absoluto σ·C. Hay un valor intermedio útil.',
          correct: true,
          explanation: 'Correcto. Una heurística habitual es fijar C cerca de la mediana de las normas de las actualizaciones. Observa en el experimento combinado la fracción de actualizaciones recortadas y la precisión al variar C.',
        },
        {
          id: 'b',
          text: 'Cuanto mayor C, mayor privacidad.',
          correct: false,
          explanation: 'Incorrecto. Con σ fijo, ε no depende de C (el ruido escala con C); lo que cambia es la utilidad. Un C grande sin aumentar el ruido rompería la garantía.',
        },
        {
          id: 'c',
          text: 'C no influye en la utilidad, solo en la privacidad.',
          correct: false,
          explanation: 'Incorrecto. C afecta directamente a la utilidad: por el sesgo del recorte y por la magnitud del ruido σ·C.',
        },
        {
          id: 'd',
          text: 'C debe elegirse mirando las actualizaciones privadas sin ningún coste.',
          correct: false,
          explanation: 'Incorrecto. Ajustar hiperparámetros sobre datos privados también filtra información y, en rigor, debería contabilizarse (o usar datos públicos/proxy).',
        },
      ],
      learnMore: [{ label: 'Experimento combinado — FL + DP', path: '/combined' }],
    },
  ],
};

export const MODULE_TITLES: Record<QuizModule, string> = {
  dp: 'Módulo 1 — Privacidad Diferencial',
  fl: 'Módulo 2 — Aprendizaje Federado',
  combined: 'Módulo 3 — DP + FL',
};

export interface QuizState {
  /** Respuesta (primer intento) por id de pregunta. */
  answers: Record<string, string>;
}
export const EMPTY_QUIZ: QuizState = { answers: {} };

export function scoreQuiz(module: QuizModule, state: QuizState): { correct: number; answered: number; total: number } {
  const qs = QUESTIONS[module];
  let correct = 0;
  let answered = 0;
  for (const q of qs) {
    const a = state.answers[q.id];
    if (!a) continue;
    answered++;
    if (q.options.find((o) => o.id === a)?.correct) correct++;
  }
  return { correct, answered, total: qs.length };
}
