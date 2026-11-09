import { useMemo } from 'react';
import { ArrowRight, Compass, History, ShieldCheck, Network, Layers, GraduationCap, RefreshCw, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ParamChoice } from '@/components/lab/ParamControl';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { METHOD_STEPS, StatTile } from '@/components/lab/Blocks';
import { Term } from '@/components/lab/Term';
import { usePersistentState } from '@/lib/store';
import { createSeededRng } from '@/lib/rng/rng';
import { simulateLaplace } from '@/lib/dp/laplace';
import { histogram } from '@/lib/stats';
import { href } from '@/lib/router';
import { EXPERIMENTS, MODULES, type ModuleId } from '@/modules/registry';
import type { GuaranteeKind } from '@/lib/runs';
import { cn } from '@/lib/utils';

const QUESTIONS = [
  '¿Qué protege la Privacidad Diferencial?',
  '¿Cómo afecta ε a la privacidad y a la utilidad?',
  '¿Por qué la Privacidad Diferencial introduce ruido?',
  '¿Cómo funciona el Aprendizaje Federado?',
  '¿Qué información se intercambia durante el entrenamiento federado?',
  '¿Por qué mantener los datos en local no garantiza la privacidad?',
  '¿Qué ocurre cuando los datos de los clientes son non-IID?',
  '¿Cómo pueden combinarse la Privacidad Diferencial y el Aprendizaje Federado?',
  '¿Cuáles son los compromisos computacionales y de privacidad?',
  '¿En qué condiciones conviene usar cada enfoque?',
];

const MODULE_STYLE: Record<ModuleId, { Icon: typeof ShieldCheck; color: string; border: string; desc: string }> = {
  dp: { Icon: ShieldCheck, color: 'text-dp', border: 'border-t-dp', desc: 'Conjuntos vecinos, mecanismo de Laplace, privacidad vs utilidad, presupuesto ε y DP-SGD.' },
  fl: { Icon: Network, color: 'text-fl', border: 'border-t-fl', desc: 'Tres hospitales entrenan un modelo compartido: FedAvg paso a paso, datos non-IID, comunicación y fugas.' },
  combined: { Icon: Layers, color: 'text-primary', border: 'border-t-primary', desc: 'Centralizado vs federado vs federado con DP a nivel de cliente, en condiciones comparables.' },
};

function LaplaceTeaser() {
  const [eps, setEps] = usePersistentState<number>('overview.eps', 1);
  const [seed, setSeed] = usePersistentState<number>('overview.seed', 7);
  const trueCount = 42;
  const sim = useMemo(() => simulateLaplace(trueCount, 1, eps, 400, createSeededRng(seed)), [eps, seed]);
  const bins = useMemo(() => histogram(sim.releases, 25, [trueCount - 15, trueCount + 15]), [sim]);
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const outside = sim.releases.filter((r) => r < trueCount - 15 || r > trueCount + 15).length;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Pruébalo ya: 400 publicaciones de un conteo con ruido de Laplace</h2>
        <IntegrityBadge kind="real" />
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Conteo real = {trueCount}. Cada barra cuenta cuántas de las 400 respuestas ruidosas cayeron en ese intervalo. Escala del ruido b = 1/<Term k="epsilon">ε</Term>.
      </p>
      <div className="flex h-28 items-end gap-[2px]" role="img" aria-label={`Histograma de 400 respuestas con ε = ${eps}; error absoluto medio ${sim.meanAbsError.toFixed(2)}`}>
        {bins.map((b) => (
          <div
            key={b.mid}
            className={cn('flex-1 rounded-t-sm', b.x0 <= trueCount && trueCount < b.x1 ? 'bg-dp' : 'bg-dp/40')}
            style={{ height: `${(b.count / maxC) * 100}%` }}
            title={`[${b.x0.toFixed(1)}, ${b.x1.toFixed(1)}): ${b.count}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground num">
        <span>{trueCount - 15}</span>
        <span>{trueCount}</span>
        <span>{trueCount + 15}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <ParamChoice label="Privacidad ε" value={eps} options={[0.1, 0.5, 1, 2, 5, 10] as const} onChange={setEps} />
        <Button size="sm" variant="outline" className="self-end" onClick={() => setSeed((s) => s + 1)}>
          <RefreshCw /> Nueva muestra
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="Escala b" value={sim.scale.toLocaleString('es-ES', { maximumFractionDigits: 2 })} />
        <StatTile label="Error abs. medio" value={sim.meanAbsError.toLocaleString('es-ES', { maximumFractionDigits: 2 })} sub={`teórico: ${sim.theoreticalMAE.toLocaleString('es-ES', { maximumFractionDigits: 2 })}`} tone="dp" />
        <StatTile label="Fuera del gráfico" value={outside} sub="respuestas" />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Menor ε ⇒ más ruido ⇒ más privacidad y menos precisión. Pero publicar 400 respuestas como aquí costaría 400·ε de presupuesto: lo vemos en el experimento de composición.
      </p>
    </div>
  );
}

export default function Overview() {
  const modules: ModuleId[] = ['dp', 'fl', 'combined'];
  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col justify-center rounded-lg border bg-card p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Laboratorio interactivo · Posgrado en ML, IA y Ciberseguridad</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Privacy-Preserving ML Lab</h1>
          <p className="mt-2 text-lg text-muted-foreground">Comprender la Privacidad Diferencial y el Aprendizaje Federado mediante la experimentación</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed">
            Aquí no hay resultados precalculados: cada gráfico se calcula en tu navegador con mecanismos reales (Laplace, gaussiano, recorte, FedAvg) sobre datos sintéticos. El objetivo no es que estas técnicas parezcan
            impresionantes, sino entender con precisión <strong>qué protegen, qué no protegen y qué cuestan</strong>.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild>
              <a href={href('/journey')}>
                <Compass /> Empezar la ruta guiada
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={href('/dp/1')}>
                Ir al primer experimento <ArrowRight />
              </a>
            </Button>
            <Button variant="ghost" asChild>
              <a href={href('/history')}>
                <History /> Historial
              </a>
            </Button>
          </div>
          <ol className="mt-6 flex flex-wrap gap-1 text-[11px] text-muted-foreground" aria-label="Metodología del laboratorio">
            {METHOD_STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1">
                <span className="rounded-full border bg-background px-2 py-0.5">
                  <span className="num mr-1 opacity-60">{i + 1}</span>
                  {s}
                </span>
                {i < METHOD_STEPS.length - 1 && <span aria-hidden>→</span>}
              </li>
            ))}
          </ol>
        </div>
        <LaplaceTeaser />
      </section>

      <section aria-labelledby="mods">
        <h2 id="mods" className="mb-3 text-lg font-semibold">
          Módulos
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {modules.map((m) => {
            const s = MODULE_STYLE[m];
            const exps = EXPERIMENTS.filter((e) => e.module === m);
            return (
              <div key={m} className={cn('flex flex-col rounded-lg border border-t-4 bg-card p-4', s.border)}>
                <h3 className={cn('flex items-center gap-2 font-semibold', s.color)}>
                  <s.Icon className="h-5 w-5" aria-hidden /> {MODULES[m].title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                <ol className="mt-3 flex-1 space-y-1">
                  {exps.map((e) => (
                    <li key={e.id}>
                      <a href={href(e.path)} className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                        <span className="num mt-0.5 text-xs text-muted-foreground">{m === 'combined' ? '★' : `${e.index}.`}</span>
                        <span className="flex-1">{e.title}</span>
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ol>
                <a href={href(MODULES[m].quizPath)} className="mt-3 flex items-center gap-1 border-t pt-3 text-xs font-medium text-primary hover:underline">
                  <GraduationCap className="h-3.5 w-3.5" aria-hidden /> Comprobación de conocimientos
                </a>
              </div>
            );
          })}
        </div>
        <a href={href('/quiz')} className="mt-3 flex items-center gap-2 rounded-lg border border-dashed bg-card p-3 text-sm hover:bg-accent">
          <GraduationCap className="h-4 w-4 text-primary" aria-hidden />
          <span>
            <strong>Reto final:</strong> elige una arquitectura de ML con privacidad para una organización ficticia con requisitos de precisión, privacidad y comunicación.
          </span>
          <ArrowRight className="ml-auto h-4 w-4" aria-hidden />
        </a>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="mb-1 text-base font-semibold">Preguntas que podrás responder</h2>
          <p className="mb-3 text-xs text-muted-foreground">Al terminar el laboratorio deberías poder responder, con argumentos y evidencia de tus experimentos:</p>
          <ol className="space-y-1.5 text-sm">
            {QUESTIONS.map((q, i) => (
              <li key={q} className="flex gap-2">
                <span className="num w-5 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <h2 className="mb-1 text-base font-semibold">Integridad científica: lee las etiquetas</h2>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Cada resultado indica qué tipo de afirmación es. Un ε solo se muestra si hay un contador válido y se cumplen sus supuestos; en otro caso verás «No calculado».
          </p>
          <ul className="space-y-2">
            {(['real', 'sim', 'formal', 'empirical', 'concept', 'not-computed'] as GuaranteeKind[]).map((k) => (
              <li key={k}>
                <IntegrityBadge kind={k} />
              </li>
            ))}
          </ul>
          <a href={href('/limits')} className="mt-4 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <ShieldQuestion className="h-4 w-4" aria-hidden /> Lo que esta simulación NO demuestra
          </a>
        </div>
      </section>
    </div>
  );
}
