import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Play, RefreshCcw, ShieldAlert } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Legend, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamChoice, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, SERIES, axisProps, gridProps, legendProps, tooltipProps, fmtNum } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { uid } from '@/lib/utils';
import { createSeededRng, deriveSeed } from '@/lib/rng/rng';
import { laplaceMechanism, simulateLaplace } from '@/lib/dp/laplace';
import { checkSpend, remaining, repeatedReleaseExperiment, spend, totalSpent, type BudgetLedger } from '@/lib/dp/composition';
import { boundedMeanSensitivity, clampedMean } from '@/lib/dp/sensitivity';
import { histogram, mean, std } from '@/lib/stats';
import { f, fromLabeled, toLabeled } from './common';

const ID = 'dp4';
const TITLE = 'Composición del presupuesto de privacidad';
const N = 200;
const DATASET_SEED = 2024;
const AGE_L = 18;
const AGE_U = 90;

type QueryId = 'countSensitive' | 'countOver60' | 'meanAge';
type Params = { query: QueryId; epsilon: number; seed: number; k: number; epsRep: number };
const DEFAULTS: Params = { query: 'countSensitive', epsilon: 0.5, seed: 42, k: 10, epsRep: 0.5 };
const LABELS: Record<keyof Params, string> = { query: 'Consulta', epsilon: 'ε de la consulta', seed: 'Semilla', k: 'k repeticiones', epsRep: 'ε por repetición' };
const DEFAULT_LEDGER: BudgetLedger = { limit: 2, entries: [] };

interface Person {
  age: number;
  s: 0 | 1;
}
/** Conjunto de datos sintético fijo del "análisis" (no cambia con la semilla del ruido). */
const DATASET: Person[] = (() => {
  const rng = createSeededRng(DATASET_SEED);
  return Array.from({ length: N }, () => ({ age: Math.round(Math.min(99, Math.max(16, rng.normal(47, 17)))), s: (rng.next() < 0.3 ? 1 : 0) as 0 | 1 }));
})();

const QUERIES: Record<QueryId, { label: string; sensitivity: number; value: number; note: string }> = {
  countSensitive: { label: 'Conteo de personas con atributo sensible', sensitivity: 1, value: DATASET.filter((p) => p.s === 1).length, note: 'Δ = 1' },
  countOver60: { label: 'Conteo de personas mayores de 60', sensitivity: 1, value: DATASET.filter((p) => p.age > 60).length, note: 'Δ = 1' },
  meanAge: {
    label: `Media de edad (límites [${AGE_L}, ${AGE_U}])`,
    sensitivity: boundedMeanSensitivity(AGE_L, AGE_U, N).value,
    value: clampedMean(DATASET.map((p) => p.age), AGE_L, AGE_U),
    note: `Δ = (${AGE_U} − ${AGE_L})/${N}`,
  },
};

export default function DP4Composition() {
  const [p, setP, reset] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [ledger, setLedger] = usePersistentState<BudgetLedger>(`${ID}.ledger`, DEFAULT_LEDGER);
  const [confirmReset, setConfirmReset] = useState(false);
  const { addRun } = useRuns(ID);
  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));
  const spent = totalSpent(ledger);
  const rem = remaining(ledger);
  const check = p.epsilon > 0 ? checkSpend(ledger, p.epsilon) : { ok: false, reason: 'ε debe ser positivo.', spentAfter: spent, remainingAfter: rem };
  const q = QUERIES[p.query];
  const errors: string[] = [];
  if (!(p.epsilon > 0)) errors.push('ε debe ser positivo.');
  if (!Number.isInteger(p.k) || p.k < 1 || p.k > 100) errors.push('k debe estar entre 1 y 100.');

  const runQuery = () => {
    if (!check.ok || errors.length) return;
    const rng = createSeededRng(deriveSeed(p.seed, 'query', ledger.entries.length, p.query));
    const r = laplaceMechanism(q.value, q.sensitivity, p.epsilon, rng);
    const entry = { id: uid('q'), label: q.label, epsilon: p.epsilon, trueValue: q.value, released: r.released, timestamp: Date.now() };
    const next = spend(ledger, entry);
    setLedger(next);
    addRun({
      experimentTitle: TITLE,
      seed: p.seed,
      params: { ...toLabeled(p, LABELS), Consulta: q.label, 'Límite ε_total': ledger.limit },
      results: { 'Valor publicado': r.released, 'Error absoluto': r.absError, 'ε acumulado': totalSpent(next), 'ε restante': remaining(next), 'Nº de consultas': next.entries.length },
      assumptions: [
        'Composición secuencial básica para mecanismos ε-DP puros: ε_total = Σ εᵢ.',
        'Vecindad por reemplazo con n público; sensibilidades: conteos Δ = 1, media acotada Δ = (U − L)/n.',
      ],
      limitations: ['La composición básica es una cota superior; existen teoremas de composición más ajustados (avanzada, RDP).', 'Aleatoriedad con semilla, no segura.'],
      privacyGuarantee: `El conjunto de las ${next.entries.length} publicaciones satisface ${f(totalSpent(next))}-DP pura (bajo supuestos).`,
    });
  };

  // Ataque de promediado sobre publicaciones repetidas del mismo tipo
  const repeats = useMemo(() => {
    const groups = new Map<string, { label: string; released: number[]; trueValue: number; eps: number }>();
    for (const e of ledger.entries) {
      const g = groups.get(e.label) ?? { label: e.label, released: [], trueValue: e.trueValue ?? NaN, eps: 0 };
      g.released.push(e.released ?? NaN);
      g.eps += e.epsilon;
      groups.set(e.label, g);
    }
    return [...groups.values()].filter((g) => g.released.length > 1);
  }, [ledger]);

  // Comparación: una publicación vs media de k publicaciones
  const cmp = useMemo(() => {
    if (!(p.epsRep > 0) || !Number.isInteger(p.k) || p.k < 1 || p.k > 100) return null;
    const trueV = QUERIES.countSensitive.value;
    const r = repeatedReleaseExperiment(trueV, 1, p.epsRep, p.k, 3000, createSeededRng(deriveSeed(p.seed, 'repeat', p.k, p.epsRep)));
    const single_kEps = simulateLaplace(trueV, 1, p.k * p.epsRep, 3000, createSeededRng(deriveSeed(p.seed, 'kEps'))).releases;
    const b = 1 / p.epsRep;
    const range: [number, number] = [trueV - 5 * b, trueV + 5 * b];
    const h1 = histogram(r.single, 50, range);
    const h2 = histogram(r.averaged, 50, range);
    return {
      trueV,
      data: h1.map((h, i) => ({ x: h.mid, unica: h.density, promedio: h2[i].density })),
      sdSingle: std(r.single),
      sdAvg: std(r.averaged),
      sdKEps: std(single_kEps),
      maeSingle: mean(r.single.map((v) => Math.abs(v - trueV))),
      maeAvg: mean(r.averaged.map((v) => Math.abs(v - trueV))),
      total: r.totalEpsilonAveraged,
    };
  }, [p.k, p.epsRep, p.seed]);

  const pctSpent = Math.min(100, (spent / ledger.limit) * 100);

  return (
    <ExperimentLayout
      experimentId={ID}
      module="dp"
      kicker="Experimento 4"
      title={TITLE}
      objective="Entender que cada publicación consume parte de un presupuesto de privacidad finito, que la garantía de varias consultas es más débil que la de una sola, y por qué cambiar la semilla no repone el presupuesto."
      badges={['real', 'formal', 'empirical']}
      intro={
        <>
          <p>
            Un analista tiene acceso a una base de datos de {N} personas ficticias y puede hacer consultas con DP. Pregunta el número de personas con el atributo sensible con ε = 0,5. Luego vuelve a preguntar lo mismo... y
            otra vez. Cada respuesta tiene ruido nuevo e independiente: promediándolas, el ruido se cancela y el analista se acerca al valor exacto. La privacidad se «gasta».
          </p>
          <p>
            La regla de <Term k="composition">composición secuencial</Term> lo cuantifica: k mecanismos con ε₁, …, ε_k sobre los mismos datos cumplen (ε₁ + … + ε_k)-DP. Por eso se fija un{' '}
            <Term k="budget">presupuesto total</Term> y se rechazan las consultas que lo superarían.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="Presupuesto">
            <ParamSlider
              label="Límite ε_total"
              ariaLabel="Límite de épsilon total"
              value={ledger.limit}
              min={0.1}
              max={20}
              step={0.1}
              onChange={(limit) => setLedger((l) => ({ ...l, limit }))}
              validate={(v) => (v + 1e-12 < spent ? `No puede ser menor que lo ya gastado (${f(spent)}).` : null)}
              help="En la práctica lo fija una política antes del análisis, no el analista."
            />
          </ConfigSection>
          <ConfigSection title="Nueva consulta">
            <div className="space-y-1">
              <label htmlFor="dp4-q" className="text-xs font-medium">Consulta</label>
              <NativeSelect id="dp4-q" value={p.query} onChange={(e) => set({ query: e.target.value as QueryId })}>
                {(Object.keys(QUERIES) as QueryId[]).map((k) => (
                  <option key={k} value={k}>{QUERIES[k].label}</option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground"><Term k="sensitivity">Sensibilidad</Term>: {q.note} = {f(q.sensitivity, 4)}</p>
            </div>
            <ParamChoice label={<Term k="epsilon">ε de esta consulta</Term>} value={p.epsilon} options={[0.1, 0.25, 0.5, 1, 2]} onChange={(epsilon) => set({ epsilon })} />
            <SeedControl value={p.seed} onChange={(seed) => set({ seed })} />
          </ConfigSection>
          <ErrorList errors={errors} />
          {!check.ok && check.reason && (
            <Callout kind="danger" title="Consulta bloqueada">
              {check.reason}
            </Callout>
          )}
          <Button variant="dp" className="w-full" disabled={!check.ok || errors.length > 0} onClick={runQuery}>
            <Play /> Ejecutar consulta (gasta ε = {f(p.epsilon)})
          </Button>
          <ConfigSection title="Comparación de repeticiones">
            <ParamSlider label="k publicaciones repetidas" ariaLabel="Número de publicaciones repetidas" value={p.k} min={1} max={100} step={1} onChange={(k) => set({ k })} />
            <ParamSlider label="ε por publicación" ariaLabel="Épsilon por publicación" value={p.epsRep} min={0.05} max={5} step={0.05} onChange={(epsRep) => set({ epsRep })} />
          </ConfigSection>
        </>
      }
      visual={
        <>
          <VisualCard title="Presupuesto de privacidad" description={`ε gastado ${f(spent)} de ${f(ledger.limit)}`} actions={<IntegrityBadge kind="formal" />}>
            <div className="mb-1 flex justify-between text-xs">
              <span>Gastado: <strong className="num">{f(spent)}</strong></span>
              <span>Restante: <strong className="num">{f(rem)}</strong></span>
            </div>
            <div className="flex h-8 w-full overflow-hidden rounded-md border bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={ledger.limit} aria-valuenow={spent} aria-label="Presupuesto de privacidad gastado">
              {ledger.entries.map((e, i) => (
                <motion.div
                  key={e.id}
                  initial={{ width: 0 }}
                  animate={{ width: `${(e.epsilon / ledger.limit) * 100}%` }}
                  className="flex items-center justify-center border-r border-background text-[10px] font-semibold text-white"
                  style={{ background: SERIES[i % SERIES.length] }}
                  title={`${e.label}: ε = ${e.epsilon}`}
                >
                  {e.epsilon / ledger.limit > 0.06 ? `#${i + 1}` : ''}
                </motion.div>
              ))}
              {check.ok && p.epsilon > 0 && (
                <div className="border-2 border-dashed border-dp/60 bg-dp/10" style={{ width: `${(p.epsilon / ledger.limit) * 100}%` }} title="Próxima consulta" aria-hidden />
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">El recuadro discontinuo muestra lo que gastaría la próxima consulta.</p>
            {pctSpent >= 80 && (
              <Callout kind="warn" className="mt-3" title={pctSpent >= 100 ? 'Presupuesto agotado' : 'Presupuesto casi agotado'}>
                {pctSpent >= 100 ? 'No se pueden hacer más consultas sobre este conjunto de datos.' : `Queda ε = ${f(rem)}. Prioriza las consultas más importantes.`}
              </Callout>
            )}
            {ledger.entries.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">Registro de consultas</caption>
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th scope="col" className="py-1 text-left font-medium">#</th>
                      <th scope="col" className="py-1 text-left font-medium">Consulta</th>
                      <th scope="col" className="py-1 text-right font-medium">ε</th>
                      <th scope="col" className="py-1 text-right font-medium">Publicado</th>
                      <th scope="col" className="py-1 text-right font-medium">ε acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.entries.map((e, i) => (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="py-1"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />{i + 1}</td>
                        <td className="py-1">{e.label}</td>
                        <td className="num py-1 text-right">{f(e.epsilon)}</td>
                        <td className="num py-1 text-right">{f(e.released ?? NaN, 3)}</td>
                        <td className="num py-1 text-right">{f(ledger.entries.slice(0, i + 1).reduce((s, x) => s + x.epsilon, 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Aún no hay consultas. Ejecuta, por ejemplo, A: ε = 0,5; B: ε = 0,5; C: ε = 1 y observa el total.</p>
            )}
            <div className="mt-3 border-t pt-3">
              {!confirmReset ? (
                <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
                  <RefreshCcw /> Nuevo análisis (restablecer presupuesto)…
                </Button>
              ) : (
                <Callout kind="warn" title="¿Restablecer el presupuesto?">
                  <p>En un sistema real, el presupuesto pertenece al <strong>conjunto de datos</strong>: restablecerlo solo es legítimo con datos nuevos o bajo una política explícita. Las publicaciones anteriores siguen siendo
                  públicas y su pérdida de privacidad no desaparece.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => { setLedger({ ...ledger, entries: [] }); setConfirmReset(false); }}>Restablecer</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Cancelar</Button>
                  </div>
                </Callout>
              )}
            </div>
          </VisualCard>
          {cmp && (
            <VisualCard title="Una publicación frente a la media de k publicaciones" description={`Conteo verdadero ${cmp.trueV}; ε = ${f(p.epsRep)} por publicación; 3000 simulaciones`} actions={<IntegrityBadge kind="empirical" />}>
              <ChartFrame
                title="Distribución de la estimación del observador"
                description={`Una sola publicación (coste ε = ${f(p.epsRep)}) frente a promediar ${p.k} publicaciones independientes (coste ${f(cmp.total)}). La media se concentra en el valor verdadero: repetir revela más.`}
                data={cmp.data}
                columns={[
                  { key: 'x', label: 'Estimación' },
                  { key: 'unica', label: 'Densidad: una publicación' },
                  { key: 'promedio', label: `Densidad: media de ${p.k}` },
                ]}
              >
                <ComposedChart data={cmp.data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtNum(1)} {...axisProps} />
                  <YAxis tickFormatter={fmtNum(3)} {...axisProps} width={50} />
                  <Tooltip {...tooltipProps} formatter={fmtNum(4)} labelFormatter={fmtNum(2)} />
                  <Legend {...legendProps} />
                  <Area type="step" dataKey="unica" name={`Una publicación (ε = ${f(p.epsRep)})`} stroke={C.c1} fill={C.c1} fillOpacity={0.2} isAnimationActive={false} />
                  <Area type="step" dataKey="promedio" name={`Media de ${p.k} (ε total = ${f(cmp.total)})`} stroke={C.c5} fill={C.c5} fillOpacity={0.25} isAnimationActive={false} />
                  <ReferenceLine x={cmp.trueV} stroke={C.fg} strokeDasharray="4 3" />
                </ComposedChart>
              </ChartFrame>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <StatTile label="Desv. típica: una" value={f(cmp.sdSingle)} sub={`ε = ${f(p.epsRep)}`} />
                <StatTile label={`Desv. típica: media de ${p.k}`} value={f(cmp.sdAvg)} sub={`ε total = ${f(cmp.total)}`} tone="warn" />
                <StatTile label={`Desv. típica: una con ε = ${f(cmp.total)}`} value={f(cmp.sdKEps)} sub="mismo coste total" tone="dp" />
              </div>
            </VisualCard>
          )}
        </>
      }
      observations={
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Consultas" value={ledger.entries.length} />
            <StatTile label="ε total gastado" value={f(spent)} tone="dp" sub={`de ${f(ledger.limit)}`} />
          </div>
          <Callout kind="info" title="Una consulta frente a varias">
            Cada publicación individual cumple su propio εᵢ, pero el conjunto de todas solo garantiza Σεᵢ = {f(spent)}. Lo que importa para la persona es la pérdida acumulada.
          </Callout>
          <Callout kind="warn" title="Cambiar la semilla NO repone el presupuesto">
            <ShieldAlert className="mb-1 inline h-4 w-4" aria-hidden /> La semilla solo hace reproducible el ruido en el laboratorio. Una ejecución con otra semilla es una publicación nueva con ruido nuevo, y gasta ε igual. Prueba a
            cambiarla: el contador no se mueve hacia atrás.
          </Callout>
          {repeats.map((g) => (
            <Callout key={g.label} kind="danger" title="Ataque de promediado sobre tus consultas">
              Has publicado «{g.label}» {g.released.length} veces (ε total {f(g.eps)}). La media de tus publicaciones es {f(mean(g.released), 3)}; el valor exacto es {f(g.trueValue, 3)}. Cuantas más repeticiones, más se acerca.
            </Callout>
          ))}
          {cmp && (
            <p className="text-[13px] leading-relaxed">
              Promediar {p.k} publicaciones reduce la desviación típica de {f(cmp.sdSingle)} a {f(cmp.sdAvg)} (≈ 1/√k). Fíjate en que una sola publicación con el mismo ε total ({f(cmp.total)}) es aún más precisa: la composición básica es
              una cota conservadora, y gastar el presupuesto de una vez suele dar más utilidad que repartirlo.
            </p>
          )}
        </>
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => setP(fromLabeled({ ...r.params, Consulta: (Object.keys(QUERIES) as QueryId[]).find((k) => QUERIES[k].label === r.params['Consulta']) ?? DEFAULTS.query }, LABELS, DEFAULTS))} onReset={reset} />}
      details={
        <ShowCalculations
          equations={['ε_total = Σᵢ εᵢ  (composición secuencial básica, ε-DP pura)', 'Restante = ε_límite − ε_total', 'Consulta permitida ⇔ ε_total + ε_nueva ≤ ε_límite', 'Var(media de k Laplace(b)) = 2b²/k']}
          inputs={[
            { label: 'Límite ε', value: f(ledger.limit) },
            { label: 'n (conjunto fijo)', value: N },
            ...(Object.keys(QUERIES) as QueryId[]).map((k) => ({ label: `Δ de «${QUERIES[k].label}»`, value: f(QUERIES[k].sensitivity, 4) })),
          ]}
          intermediates={ledger.entries.map((e, i) => ({ label: `#${i + 1} ${e.label}`, value: `ε = ${f(e.epsilon)}, verdadero ${f(e.trueValue ?? NaN, 3)}, publicado ${f(e.released ?? NaN, 3)}` }))}
          outputs={[
            { label: 'ε total gastado', value: f(spent, 4) },
            { label: 'ε restante', value: f(rem, 4) },
            { label: 'Próxima consulta', value: check.ok ? `permitida (total pasaría a ${f(check.spentAfter)})` : 'bloqueada' },
          ]}
          assumptions={[
            'Todos los mecanismos son ε-DP puros (Laplace) y se aplican sobre el mismo conjunto de datos.',
            'Vecindad por reemplazo con n público (necesaria para la sensibilidad de la media).',
            'Los valores verdaderos se muestran solo con fines didácticos; en un sistema real el analista no los vería.',
            'La semilla del ruido es un mecanismo de reproducibilidad: no forma parte de la contabilidad.',
          ]}
        />
      }
      prosCons={{
        benefits: ['La composición permite razonar sobre análisis completos, no solo consultas aisladas.', 'Un presupuesto explícito obliga a priorizar qué se publica.', 'La regla secuencial es simple y siempre válida para ε-DP pura.'],
        limitations: [
          'La composición básica es pesimista; con muchas consultas, la composición avanzada o RDP da cotas mucho menores.',
          'Un presupuesto agotado impide nuevas consultas sobre esos datos.',
          'Decidir el presupuesto total es una cuestión de política, no puramente técnica.',
        ],
      }}
      reflection={{
        question: 'Tienes ε_total = 2 y necesitas publicar tres estadísticas. ¿Repartirías el presupuesto a partes iguales? ¿Qué ocurre con la precisión de cada una? ¿Y si una de ellas es mucho más importante?',
        hint: 'El error de cada consulta es proporcional a Δ/εᵢ. Puedes asignar más ε a las consultas importantes o a las de mayor sensibilidad relativa; la suma no puede superar el límite.',
      }}
    />
  );
}
