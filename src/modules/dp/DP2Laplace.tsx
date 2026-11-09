import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, StepForward, FastForward } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamChoice, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, Formula, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps, fmtNum } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { createSeededRng, deriveSeed } from '@/lib/rng/rng';
import { laplaceCdf, laplaceMechanism, laplacePdf, laplaceScale, simulateLaplace, type LaplaceRelease, type LaplaceSimulation } from '@/lib/dp/laplace';
import { histogram } from '@/lib/stats';
import { EPS_OPTIONS, MathSection, TermList, f, fromLabeled, toLabeled } from './common';

const ID = 'dp2';
const TITLE = 'Añadir ruido con Privacidad Diferencial';

type Params = { n: number; k: number; epsilon: number; seed: number; reps: number };
const DEFAULTS: Params = { n: 100, k: 37, epsilon: 1, seed: 42, reps: 1000 };
const LABELS: Record<keyof Params, string> = {
  n: 'Tamaño del conjunto (n)',
  k: 'Personas que cumplen la condición',
  epsilon: 'ε',
  seed: 'Semilla',
  reps: 'Repeticiones',
};

interface Result {
  params: Params;
  single: LaplaceRelease;
  sim: LaplaceSimulation;
}

function validate(p: Params): string[] {
  const e: string[] = [];
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > 100000) e.push('n debe ser un entero entre 1 y 100 000.');
  if (!Number.isInteger(p.k) || p.k < 0) e.push('El número de personas que cumplen la condición debe ser un entero ≥ 0.');
  if (p.k > p.n) e.push('El número de personas que cumplen la condición no puede superar n.');
  if (!(p.epsilon > 0)) e.push('ε debe ser positivo.');
  if (!Number.isInteger(p.reps) || p.reps < 10 || p.reps > 20000) e.push('Las repeticiones deben estar entre 10 y 20 000.');
  return e;
}

const STEPS = ['Resultado exacto', 'Escala del ruido', 'Muestra de ruido', 'Publicación', 'Error'];

function NumberLine({ r, step }: { r: LaplaceRelease; step: number }) {
  const span = Math.max(4 * r.scale, Math.abs(r.noise) * 1.3, 2);
  const lo = r.trueValue - span;
  const hi = r.trueValue + span;
  const W = 600;
  const x = (v: number) => 30 + ((v - lo) / (hi - lo)) * (W - 60);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (i * (hi - lo)) / 4);
  return (
    <svg viewBox={`0 0 ${W} 110`} className="w-full" role="img" aria-label={`Recta numérica: valor exacto ${f(r.trueValue)}, valor publicado ${f(r.released)}`}>
      <line x1={30} x2={W - 30} y1={70} y2={70} stroke={C.axis} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={66} y2={74} stroke={C.axis} />
          <text x={x(t)} y={90} fontSize={11} textAnchor="middle" fill={C.axis}>{f(t, 1)}</text>
        </g>
      ))}
      {step >= 1 && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <circle cx={x(r.trueValue)} cy={70} r={6} fill={C.c1} />
          <text x={x(r.trueValue)} y={50} fontSize={11} textAnchor="middle" fill={C.c1}>verdadero {f(r.trueValue)}</text>
        </motion.g>
      )}
      {step >= 2 && (
        <motion.rect initial={{ opacity: 0 }} animate={{ opacity: 0.18 }} x={x(r.trueValue - r.scale)} width={x(r.trueValue + r.scale) - x(r.trueValue - r.scale)} y={62} height={16} fill={C.dp} />
      )}
      {step >= 3 && (
        <motion.line initial={{ x2: x(r.trueValue) }} animate={{ x2: x(r.released) }} transition={{ duration: 0.6 }} x1={x(r.trueValue)} y1={30} y2={30} stroke={C.warn} strokeWidth={2} />
      )}
      {step >= 3 && (
        <text x={(x(r.trueValue) + x(r.released)) / 2} y={22} fontSize={11} textAnchor="middle" fill={C.warn}>ruido {f(r.noise)}</text>
      )}
      {step >= 4 && (
        <motion.g initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <path d={`M ${x(r.released)} 62 l -6 -10 h 12 z`} fill={C.dp} />
          <text x={x(r.released)} y={106} fontSize={11} textAnchor="middle" fill={C.dp} fontWeight={600}>publicado {f(r.released)}</text>
        </motion.g>
      )}
    </svg>
  );
}

export default function DP2Laplace() {
  const [p, setP, reset] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [res, setRes] = usePersistentState<Result | null>(`${ID}.result`, null, false);
  const [step, setStep] = useState(5);
  const { addRun } = useRuns(ID);
  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));
  const errors = validate(p);
  const scale = p.epsilon > 0 ? laplaceScale(1, p.epsilon) : NaN;

  const execute = () => {
    if (errors.length) return;
    const single = laplaceMechanism(p.k, 1, p.epsilon, createSeededRng(deriveSeed(p.seed, 'single')));
    const sim = simulateLaplace(p.k, 1, p.epsilon, p.reps, createSeededRng(deriveSeed(p.seed, 'reps')));
    setRes({ params: p, single, sim });
    setStep(1);
    addRun({
      experimentTitle: TITLE,
      seed: p.seed,
      params: toLabeled(p, LABELS),
      results: {
        'Conteo verdadero': single.trueValue,
        'Conteo publicado': single.released,
        'Ruido añadido': single.noise,
        'Error absoluto': single.absError,
        'Escala b = 1/ε': single.scale,
        'Error abs. medio (repeticiones)': sim.meanAbsError,
        'Error abs. medio teórico (b)': sim.theoreticalMAE,
      },
      assumptions: ['Consulta de conteo con sensibilidad Δ = 1 (cada persona aparece una sola vez).', 'Ruido Laplace(0, 1/ε) muestreado por inversión de la CDF.'],
      limitations: ['Aleatoriedad pseudoaleatoria con semilla (no segura).', 'Implementación en punto flotante, sin protección frente a ataques de bits menos significativos.'],
      privacyGuarantee: `ε-DP pura con ε = ${p.epsilon} para UNA publicación (bajo supuestos de aleatoriedad ideal). Las ${p.reps} repeticiones simuladas son una herramienta didáctica: publicarlas todas costaría ${p.reps}·ε.`,
    });
  };

  const chart = useMemo(() => {
    if (!res) return [];
    const b = res.single.scale;
    const lo = res.params.k - 6 * b;
    const hi = res.params.k + 6 * b;
    return histogram(res.sim.releases, 40, [lo, hi]).map((h) => ({ x: h.mid, empirica: h.density, teorica: laplacePdf(h.mid, res.params.k, b) }));
  }, [res]);

  const S = res ? { lo: res.params.k - 0.5, hi: res.params.k + 0.5 } : null;
  const pD = res && S ? laplaceCdf(S.hi, res.params.k, res.single.scale) - laplaceCdf(S.lo, res.params.k, res.single.scale) : NaN;
  const pDp = res && S ? laplaceCdf(S.hi, res.params.k - 1, res.single.scale) - laplaceCdf(S.lo, res.params.k - 1, res.single.scale) : NaN;
  const within = res ? res.sim.absErrors.filter((e) => e <= 1).length / res.sim.absErrors.length : NaN;
  const stale = res && JSON.stringify(res.params) !== JSON.stringify(p);

  return (
    <ExperimentLayout
      experimentId={ID}
      module="dp"
      kicker="Experimento 2"
      title={TITLE}
      objective="Aplicar un mecanismo de Laplace real a una consulta de conteo, entender cómo ε determina la escala del ruido y distinguir una publicación individual de la distribución de publicaciones."
      badges={['real', 'formal', 'empirical']}
      intro={
        <>
          <p>
            Una encuesta de salud quiere publicar cuántas de sus {p.n} personas participantes tienen una condición. En lugar del número exacto, publica el número más un pequeño error aleatorio. Si añadir o quitar a una
            persona solo cambia el conteo en 1, basta con que el error sea lo bastante «ancho» para que los dos mundos posibles (con y sin esa persona) produzcan resultados parecidos <em>en distribución</em>.
          </p>
          <p>
            El <Term k="laplace">mecanismo de Laplace</Term> hace exactamente eso: publica f(D) + Lap(b) con escala b = Δf/ε. Para un conteo la <Term k="sensitivity">sensibilidad</Term> es Δf = 1, así que
            b = 1/ε. Un <Term k="epsilon">ε</Term> menor implica más ruido y una garantía más fuerte.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="Datos (sintéticos)">
            <ParamSlider label="Tamaño del conjunto (n)" ariaLabel="Tamaño del conjunto" value={p.n} min={1} max={10000} step={1} onChange={(n) => set({ n, k: Math.min(p.k, n) })} />
            <ParamSlider label="Personas que cumplen la condición" ariaLabel="Personas que cumplen la condición" value={p.k} min={0} max={p.n} step={1} onChange={(k) => set({ k })} help="Es el resultado exacto del conteo f(D)." />
          </ConfigSection>
          <ConfigSection title="Mecanismo">
            <ParamChoice label={<Term k="epsilon">Presupuesto ε</Term>} value={EPS_OPTIONS.includes(p.epsilon as (typeof EPS_OPTIONS)[number]) ? (p.epsilon as (typeof EPS_OPTIONS)[number]) : (NaN as never)} options={EPS_OPTIONS} onChange={(epsilon) => set({ epsilon })} />
            <ParamSlider label="ε personalizado" ariaLabel="Épsilon personalizado" value={p.epsilon} min={0.01} max={20} step={0.01} log onChange={(epsilon) => set({ epsilon })} />
            <div className="rounded-md bg-muted px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span><Term k="sensitivity">Sensibilidad Δ</Term></span>
                <span className="num">1</span>
              </div>
              <div className="flex justify-between">
                <span>Escala del ruido b = 1/ε (derivada)</span>
                <span className="num font-semibold text-dp">{f(scale, 4)}</span>
              </div>
            </div>
          </ConfigSection>
          <ConfigSection title="Simulación">
            <ParamSlider label="Repeticiones" ariaLabel="Repeticiones" value={p.reps} min={10} max={20000} step={10} onChange={(reps) => set({ reps })} help="Ejecuciones independientes para ver la distribución de respuestas. Solo con fines didácticos." />
            <SeedControl value={p.seed} onChange={(seed) => set({ seed })} />
          </ConfigSection>
          <ErrorList errors={errors} />
          <Button variant="dp" className="w-full" disabled={errors.length > 0} onClick={execute}>
            <Play /> Ejecutar mecanismo
          </Button>
        </>
      }
      visual={
        res ? (
          <>
            {stale && <Callout kind="warn">Los parámetros han cambiado desde la última ejecución. Pulsa «Ejecutar mecanismo» para actualizar los resultados.</Callout>}
            <VisualCard
              title="Una publicación, paso a paso"
              description={`Paso ${Math.min(step, 5)} de 5: ${STEPS[Math.min(step, 5) - 1]}`}
              actions={
                <>
                  <Button size="sm" variant="outline" disabled={step >= 5} onClick={() => setStep((s) => s + 1)}>
                    <StepForward /> Siguiente paso
                  </Button>
                  <Button size="sm" variant="ghost" disabled={step >= 5} onClick={() => setStep(5)}>
                    <FastForward /> Mostrar todo
                  </Button>
                </>
              }
            >
              <NumberLine r={res.single} step={step} />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Conteo verdadero f(D)" value={f(res.single.trueValue)} />
                <StatTile label="Ruido añadido" value={step >= 3 ? f(res.single.noise) : '…'} tone="warn" />
                <StatTile label="Conteo publicado" value={step >= 4 ? f(res.single.released) : '…'} tone="dp" />
                <StatTile label="Error absoluto" value={step >= 5 ? f(res.single.absError) : '…'} />
              </div>
              <ol className="mt-3 space-y-1 text-xs text-muted-foreground">
                {step >= 1 && <li>1. Se calcula el resultado exacto: f(D) = {res.params.k}.</li>}
                {step >= 2 && <li>2. Escala b = Δ/ε = 1/{f(res.params.epsilon)} = {f(res.single.scale, 4)} (banda sombreada = ±b).</li>}
                {step >= 3 && <li>3. Se extrae Z ~ Laplace(0, b): Z = {f(res.single.noise, 4)}.</li>}
                {step >= 4 && <li>4. Se publica f(D) + Z = {f(res.single.released, 4)}. El valor exacto NO se publica.</li>}
                {step >= 5 && <li>5. Error absoluto |Z| = {f(res.single.absError, 4)} (en promedio, E|Z| = b = {f(res.single.scale, 4)}).</li>}
              </ol>
            </VisualCard>
            <VisualCard title="Distribución de respuestas en ejecuciones repetidas" description={`${res.params.reps} publicaciones independientes con ε = ${res.params.epsilon}`}>
              <ChartFrame
                title="Histograma de conteos publicados frente a la densidad de Laplace teórica"
                description={`El área sombreada es la densidad empírica; la línea, la densidad Laplace(${res.params.k}, ${f(res.single.scale)}) teórica. La línea vertical marca el valor verdadero.`}
                data={chart}
                columns={[
                  { key: 'x', label: 'Valor publicado (centro)' },
                  { key: 'empirica', label: 'Densidad empírica' },
                  { key: 'teorica', label: 'Densidad teórica' },
                ]}
              >
                <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtNum(1)} {...axisProps} />
                  <YAxis tickFormatter={fmtNum(3)} {...axisProps} width={50} />
                  <Tooltip {...tooltipProps} formatter={fmtNum(4)} labelFormatter={fmtNum(2)} />
                  <Legend {...legendProps} />
                  <Area type="step" dataKey="empirica" name="Empírica" stroke={C.dp} fill={C.dp} fillOpacity={0.25} isAnimationActive={false} />
                  <Line type="monotone" dataKey="teorica" name="Teórica" stroke={C.c1} dot={false} strokeWidth={2} isAnimationActive={false} />
                  <ReferenceLine x={res.params.k} stroke={C.fg} strokeDasharray="4 3" label={{ value: 'verdadero', fontSize: 11, fill: C.axis, position: 'top' }} />
                </ComposedChart>
              </ChartFrame>
            </VisualCard>
          </>
        ) : (
          <VisualCard title="Mecanismo de Laplace">
            <p className="text-sm text-muted-foreground">Configura los parámetros y pulsa «Ejecutar mecanismo» para extraer ruido real de una distribución de Laplace.</p>
          </VisualCard>
        )
      }
      observations={
        res ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Error abs. medio (empírico)" value={f(res.sim.meanAbsError)} sub="observado" tone="warn" />
              <StatTile label="Error abs. medio (teórico)" value={f(res.sim.theoreticalMAE)} sub="E|Z| = b" tone="dp" />
              <StatTile label="Desv. típica empírica" value={f(res.sim.stdRelease)} sub={`teórica √2·b = ${f(res.sim.theoreticalStd)}`} />
              <StatTile label="Intervalo 5 %–95 %" value={`${f(res.sim.p05, 1)} – ${f(res.sim.p95, 1)}`} />
            </div>
            <p className="text-[13px]">
              El {f(within * 100, 1)} % de las publicaciones quedan a ±1 del valor verdadero (teórico: {f((1 - Math.exp(-1 / res.single.scale)) * 100, 1)} %).
            </p>
            <Callout kind="info" title="Garantía distribucional, no por respuesta">
              La garantía dice que la <em>distribución</em> de resultados es casi la misma con o sin cualquier persona. No garantiza que cada respuesta concreta sea parecida al valor verdadero ni a la de otra ejecución: una
              publicación aislada puede caer lejos.
            </Callout>
            <Callout kind="warn" title="Las repeticiones son didácticas">
              Ver {res.params.reps} publicaciones de la misma consulta solo es posible en el laboratorio. En un sistema real, cada publicación consume ε del presupuesto (Experimento 4).
            </Callout>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Aún no hay resultados.</p>
        )
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => setP(fromLabeled(r.params, LABELS, DEFAULTS))} onReset={reset} />}
      details={
        <>
          <MathSection title="Definición matemática: P[M(D) ∈ S] ≤ exp(ε) × P[M(D′) ∈ S]">
            <Formula>P[M(D) ∈ S] ≤ exp(ε) × P[M(D′) ∈ S]   para todo par de vecinos D, D′ y todo conjunto S</Formula>
            <TermList
              items={[
                ['M', 'El mecanismo aleatorio completo: aquí, M(D) = conteo(D) + Lap(1/ε).'],
                ['D, D′', 'Dos conjuntos de datos vecinos: difieren en los datos de una sola persona.'],
                ['S', 'Cualquier conjunto de resultados posibles (p. ej. «el resultado es mayor que 40»).'],
                ['P[M(D) ∈ S]', 'Probabilidad, sobre la aleatoriedad del ruido, de que el resultado caiga en S cuando los datos son D.'],
                ['ε', 'Parámetro de privacidad: cuánto pueden diferir ambas probabilidades como máximo.'],
                ['exp(ε)', `Factor multiplicativo máximo. Con ε = ${f(p.epsilon)}: e^ε = ${f(Math.exp(p.epsilon), 3)}.`],
              ]}
            />
            {res && S && (
              <div className="rounded-md border p-3 text-[13px]">
                <p className="mb-1 font-medium">Comprobación numérica con S = [{f(S.lo, 1)}, {f(S.hi, 1)}], D con conteo {res.params.k} y D′ con conteo {res.params.k - 1}:</p>
                <p className="num">
                  P[M(D) ∈ S] = {f(pD, 4)} · P[M(D′) ∈ S] = {f(pDp, 4)} · cociente = {f(pD / pDp, 4)} ≤ e^ε = {f(Math.exp(res.params.epsilon), 4)}
                </p>
              </div>
            )}
            <p>
              La probabilidad se refiere al azar del mecanismo, no a los datos: los datos se consideran fijos. Por eso la garantía es «distribucional»: protege frente a cualquier observador, sea cual sea su conocimiento previo,
              siempre que el ruido sea realmente aleatorio y secreto.
            </p>
          </MathSection>
          {res && (
            <ShowCalculations
              equations={['b = Δf / ε', 'Z = −b · sign(U) · ln(1 − 2|U|),  U ~ Uniforme(−½, ½)', 'M(D) = f(D) + Z', 'E|Z| = b,   Var(Z) = 2b²']}
              inputs={[
                { label: 'f(D) (conteo exacto)', value: res.params.k },
                { label: 'Δf', value: 1 },
                { label: 'ε', value: f(res.params.epsilon, 4) },
                { label: 'Semilla', value: res.params.seed },
              ]}
              intermediates={[
                { label: 'b = 1/ε', value: f(res.single.scale, 6) },
                { label: 'Z (ruido muestreado)', value: f(res.single.noise, 6) },
              ]}
              outputs={[
                { label: 'M(D) publicado', value: f(res.single.released, 6) },
                { label: '|Z|', value: f(res.single.absError, 6) },
                { label: 'Error abs. medio en repeticiones', value: f(res.sim.meanAbsError, 6) },
              ]}
              assumptions={[
                'La sensibilidad del conteo es 1: cada persona contribuye como máximo una vez.',
                'El ruido es independiente de los datos y secreto para el observador.',
                'La garantía ε-DP exige aleatoriedad ideal; el PRNG con semilla solo sirve para reproducir el experimento.',
                'El resultado publicado puede ser no entero o negativo; redondearlo o truncarlo es post-procesamiento y no debilita la garantía.',
              ]}
            />
          )}
        </>
      }
      prosCons={{
        benefits: [
          'Garantía matemática que no depende del conocimiento del atacante.',
          'Calibración explícita: la escala de ruido se deriva de ε y de la sensibilidad.',
          'Post-procesar el resultado (redondear, recortar a [0, n]) no debilita la garantía.',
        ],
        limitations: [
          'Introduce error: cuanto menor ε, mayor el error esperado.',
          'La garantía cubre una publicación; repetir consultas consume más presupuesto.',
          'Requiere conocer la sensibilidad real; si se subestima, la garantía no se cumple.',
          'No hay un valor de ε «correcto» universal: es una decisión de política.',
        ],
      }}
      reflection={{
        question: 'Prueba ε = 0,1 y ε = 10 con n = 100 y luego con n = 10 000. ¿Cambia el error absoluto con n? ¿Y el error relativo (error/conteo)? ¿Qué significa para conjuntos de datos grandes y pequeños?',
        hint: 'La escala b = 1/ε no depende de n, así que el error absoluto es el mismo; pero el error relativo se reduce cuando el conteo verdadero es grande.',
      }}
    />
  );
}
