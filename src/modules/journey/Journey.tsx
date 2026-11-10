import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Compass, ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/lab/Blocks';
import { usePersistentState } from '@/lib/store';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';

interface Stage {
  id: string;
  title: string;
  question: string;
  context: string;
  objectives: string[];
  links: { label: string; path: string }[];
}

const STAGES: Stage[] = [
  {
    id: 's1',
    title: 'El problema de privacidad',
    question: '¿Por qué la información publicada puede exponer a personas?',
    context: 'Una estadística exacta depende de cada persona del conjunto de datos. Comparar dos conjuntos vecinos (con y sin una persona) muestra cuánto puede cambiar el resultado publicado.',
    objectives: [
      'Selecciona a una persona objetivo, elimínala y compara el conteo exacto en los conjuntos vecinos D y D′.',
      'Explica por qué observar una diferencia no demuestra por sí sola la pertenencia o el atributo sensible de alguien.',
    ],
    links: [{ label: 'Exp. 1 — Conjuntos vecinos', path: '/dp/1' }],
  },
  {
    id: 's2',
    title: 'Privacidad Diferencial',
    question: '¿Cómo limita el ruido calibrado la influencia individual?',
    context: 'El mecanismo de Laplace añade ruido de escala Δ/ε. La garantía es distribucional: acota el cociente de probabilidades de cualquier resultado entre conjuntos vecinos.',
    objectives: [
      'Ejecuta el mecanismo de Laplace con ε = 0,1 y con ε = 10 y compara la distribución de respuestas ruidosas.',
      'Comprueba que el error absoluto medio empírico se aproxima a la escala teórica b = 1/ε.',
    ],
    links: [{ label: 'Exp. 2 — Mecanismo de Laplace', path: '/dp/2' }],
  },
  {
    id: 's3',
    title: 'Privacidad vs precisión',
    question: '¿Cuál es el coste de una privacidad más fuerte?',
    context: 'Para la misma consulta y sensibilidad, menor ε implica más ruido. Repetir consultas consume presupuesto, y entrenar modelos con DP-SGD exige recortar y añadir ruido a los gradientes.',
    objectives: [
      'Genera la curva ε frente a error absoluto medio y describe su forma.',
      'Agota un presupuesto ε_total ejecutando varias consultas y observa el aviso al superarlo.',
      'Compara SGD y DP-SGD y anota cuándo el ε aparece como «No calculado» y por qué.',
    ],
    links: [
      { label: 'Exp. 3 — Privacidad vs utilidad', path: '/dp/3' },
      { label: 'Exp. 4 — Presupuesto ε', path: '/dp/4' },
      { label: 'Exp. 5 — DP-SGD', path: '/dp/5' },
      { label: 'Comprobación del Módulo 1', path: '/quiz/dp' },
    ],
  },
  {
    id: 's4',
    title: 'Aprendizaje Federado',
    question: '¿Cómo pueden organizaciones distribuidas entrenar un modelo compartido?',
    context: 'En FedAvg los datos se quedan en cada hospital; viajan parámetros del modelo, que el servidor promedia ponderando por el número de muestras.',
    objectives: [
      'Ejecuta una ronda de FedAvg paso a paso e inspecciona numéricamente los parámetros locales y los agregados.',
      'Verifica a mano un coeficiente de la agregación w = Σ (n_k/N) w_k.',
      'Compara IID y Non-IID y observa la variabilidad entre repeticiones.',
    ],
    links: [
      { label: 'Exp. 1 — Centralizado vs federado', path: '/fl/1' },
      { label: 'Exp. 2 — Ronda FedAvg', path: '/fl/2' },
      { label: 'Exp. 3 — IID vs Non-IID', path: '/fl/3' },
      { label: 'Exp. 4 — Comunicación', path: '/fl/4' },
    ],
  },
  {
    id: 's5',
    title: 'Limitaciones federadas',
    question: '¿Por qué mantener los datos en local no elimina los riesgos de privacidad?',
    context: 'Las actualizaciones de modelo son funciones de los datos locales. En un modelo lineal, el gradiente de un único ejemplo revela exactamente su vector de características.',
    objectives: [
      'Usa el panel de inspección para relacionar una actualización con los datos locales de un cliente.',
      'Resume qué protege (y qué no) la agregación segura, la DP y los controles de acceso.',
    ],
    links: [
      { label: 'Exp. 5 — Fugas en actualizaciones', path: '/fl/5' },
      { label: 'Comprobación del Módulo 2', path: '/quiz/fl' },
    ],
  },
  {
    id: 's6',
    title: 'Combinar DP y FL',
    question: '¿Cómo podemos reducir la fuga de privacidad a través de las actualizaciones distribuidas?',
    context: 'DP-FedAvg recorta la actualización de cada cliente a norma C y añade ruido gaussiano a la suma. La unidad de privacidad pasa a ser el cliente completo.',
    objectives: [
      'Ejecuta A (centralizado), B (FedAvg) y C (FL + DP) con la misma semilla y compara precisión y supuestos.',
      'Ejecuta el barrido privacidad–utilidad y explica el efecto de σ y de C.',
      'Cambia la participación por debajo del 100 % y explica por qué ε pasa a «No calculado».',
    ],
    links: [
      { label: 'Experimento combinado', path: '/combined' },
      { label: 'Comprobación del Módulo 3', path: '/quiz/combined' },
    ],
  },
  {
    id: 's7',
    title: 'Decisión final',
    question: '¿Qué arquitectura es apropiada según los requisitos técnicos?',
    context: 'No hay una técnica universalmente mejor: la elección depende del modelo de amenaza, la unidad de privacidad, la precisión necesaria, el número de participantes y el coste de comunicación.',
    objectives: ['Resuelve el reto práctico: elige y justifica una configuración para una organización ficticia con requisitos explícitos.'],
    links: [{ label: 'Reto final', path: '/quiz' }],
  },
  {
    id: 's8',
    title: 'Más allá del modelo (opcional)',
    question: '¿Basta con entrenar un modelo con DP y FL para que un sistema agéntico sea privado?',
    context:
      'Un agente combina un modelo con memoria persistente, herramientas con acceso a datos y contenido de distinta confianza. La DP y el FL acotan lo que los parámetros entrenados revelan sobre los datos de entrenamiento; no gobiernan qué guarda la memoria ni qué devuelve una herramienta en tiempo de inferencia.',
    objectives: [
      'En el escenario de memoria, encuentra una política con la que el usuario B ya no recibe datos del usuario A.',
      'En el escenario de herramientas, comprueba que activar «Entrenar el modelo con DP» no cambia el resultado de la exfiltración y explica por qué.',
    ],
    links: [
      { label: 'Más allá del modelo: privacidad en IA agéntica', path: '/agentic' },
      { label: 'Experimento combinado (FL + DP)', path: '/combined' },
    ],
  },
];

export default function Journey() {
  const [stage, setStage] = usePersistentState<number>('journey.stage', 0);
  const [progress, setProgress] = usePersistentState<Record<string, boolean>>('journey.progress', {});
  const idx = Math.min(STAGES.length - 1, Math.max(0, stage));
  const s = STAGES[idx];
  const totalObj = STAGES.reduce((n, st) => n + st.objectives.length, 0);
  const done = STAGES.reduce((n, st) => n + st.objectives.filter((_, i) => progress[`${st.id}.${i}`]).length, 0);
  const stageDone = (st: Stage) => st.objectives.every((_, i) => progress[`${st.id}.${i}`]);
  const toggle = (key: string) => setProgress((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div className="space-y-4">
      <header className="rounded-lg border bg-card p-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Compass className="h-6 w-6 text-primary" aria-hidden /> Ruta de aprendizaje guiada
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Siete etapas con un objetivo interactivo cada una. Puedes avanzar y retroceder libremente: tus parámetros y resultados de cada experimento se conservan, y tu progreso se guarda en este navegador.
        </p>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs">
            <span>Progreso</span>
            <span className="num">
              {done} / {totalObj} objetivos
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={totalObj} aria-valuenow={done} aria-label="Progreso de la ruta">
            <div className="h-full bg-primary transition-all" style={{ width: `${(done / totalObj) * 100}%` }} />
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Etapas" className="rounded-lg border bg-card p-2">
          <ol className="space-y-0.5">
            {STAGES.map((st, i) => (
              <li key={st.id}>
                <button
                  type="button"
                  onClick={() => setStage(i)}
                  aria-current={i === idx ? 'step' : undefined}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors', i === idx ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                >
                  {stageDone(st) ? <CheckCircle2 className={cn('h-4 w-4 shrink-0', i === idx ? '' : 'text-ok')} aria-label="completada" /> : <Circle className="h-4 w-4 shrink-0 opacity-50" aria-hidden />}
                  <span>
                    <span className="num mr-1 opacity-70">{i + 1}.</span>
                    {st.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby="stage-title">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Etapa {idx + 1} de {STAGES.length}
          </p>
          <h2 id="stage-title" className="text-xl font-semibold">
            {s.title}
          </h2>
          <p className="text-lg leading-snug">{s.question}</p>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{s.context}</p>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Objetivo interactivo</h3>
            <ul className="space-y-2">
              {s.objectives.map((o, i) => {
                const key = `${s.id}.${i}`;
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm hover:bg-accent/50">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={!!progress[key]} onChange={() => toggle(key)} />
                      <span className={cn(progress[key] && 'text-muted-foreground line-through')}>{o}</span>
                      <span className="sr-only">— objetivo completado</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Ir a</h3>
            <div className="flex flex-wrap gap-2">
              {s.links.map((l) => (
                <Button key={l.path} variant="outline" size="sm" asChild>
                  <a href={href(l.path)}>
                    {l.label} <ExternalLink />
                  </a>
                </Button>
              ))}
            </div>
          </div>

          {stageDone(s) && <Callout kind="ok">Etapa completada. Puedes continuar o volver a cualquier experimento: su estado se conserva.</Callout>}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <Button variant="outline" disabled={idx === 0} onClick={() => setStage(idx - 1)}>
              <ArrowLeft /> Anterior
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setProgress({})}>
              <RotateCcw /> Reiniciar progreso
            </Button>
            <Button disabled={idx === STAGES.length - 1} onClick={() => setStage(idx + 1)}>
              Siguiente <ArrowRight />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
