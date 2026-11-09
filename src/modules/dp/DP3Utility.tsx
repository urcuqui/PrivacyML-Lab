import { useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, LineChart, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps, fmtNum } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { runSimTask } from '@/lib/useSimTask';
import type { DpUtilityRow } from '@/lib/tasks';
import { createSeededRng, deriveSeed } from '@/lib/rng/rng';
import { laplacePdf, laplacePrivacyLoss, laplaceScale, simulateLaplace } from '@/lib/dp/laplace';
import { boundedMeanSensitivity, clampedMean } from '@/lib/dp/sensitivity';
import { histogram, mean } from '@/lib/stats';
import { f, fromLabeled, toLabeled } from './common';

const ID = 'dp3';
const TITLE = 'Privacidad frente a utilidad';
const EPSILONS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

type Params = { reps: number; seed: number; count: number; epsN: number; n: number; lower: number; upper: number; epsM: number };
const DEFAULTS: Params = { reps: 2000, seed: 42, count: 37, epsN: 1, n: 50, lower: 18, upper: 90, epsM: 1 };
const LABELS: Record<keyof Params, string> = {
  reps: 'Repeticiones por ε',
  seed: 'Semilla',
  count: 'Conteo verdadero en D',
  epsN: 'ε (vecinos)',
  n: 'n (media acotada)',
  lower: 'Límite inferior L',
  upper: 'Límite superior U',
  epsM: 'ε (media acotada)',
};

function validate(p: Params): string[] {
  const e: string[] = [];
  if (!Number.isInteger(p.reps) || p.reps < 100 || p.reps > 20000) e.push('Las repeticiones deben estar entre 100 y 20 000.');
  if (!(p.upper > p.lower)) e.push('El límite superior U debe ser mayor que el inferior L.');
  if (!Number.isInteger(p.n) || p.n < 5 || p.n > 5000) e.push('n debe estar entre 5 y 5000.');
  if (!(p.epsN > 0) || !(p.epsM > 0)) e.push('ε debe ser positivo.');
  if (!Number.isInteger(p.count) || p.count < 1) e.push('El conteo verdadero debe ser un entero ≥ 1.');
  return e;
}

/** Edades sintéticas (incluye algunas personas mayores para que los límites importen). */
function syntheticAges(n: number, seed: number): number[] {
  const rng = createSeededRng(deriveSeed(seed, 'ages', n));
  return Array.from({ length: n }, () => Math.round(Math.min(105, Math.max(0, rng.normal(46, 18)))));
}

function meanReleaseError(ages: number[], L: number, U: number, eps: number, reps: number, seed: number) {
  const trueMean = mean(ages);
  const cm = clampedMean(ages, L, U);
  const delta = boundedMeanSensitivity(L, U, ages.length).value;
  const b = delta / eps;
  const rng = createSeededRng(deriveSeed(seed, 'mean', L, U, eps));
  let s = 0;
  for (let i = 0; i < reps; i++) s += Math.abs(cm + rng.laplace(b) - trueMean);
  return { trueMean, clamped: cm, bias: cm - trueMean, delta, b, totalMAE: s / reps };
}

export default function DP3Utility() {
  const [p, setP, reset] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [sweep, setSweep] = usePersistentState<{ rows: DpUtilityRow[]; reps: number; seed: number } | null>(`${ID}.sweep`, null, false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addRun } = useRuns(ID);
  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));
  const errors = validate(p);
  const ok = errors.length === 0;

  // --- Vecinos: densidades teóricas y empíricas ---
  const neigh = useMemo(() => {
    if (!ok) return null;
    const b = laplaceScale(1, p.epsN);
    const c = p.count;
    const lo = c - 1 - 6 * b;
    const hi = c + 6 * b;
    const sD = simulateLaplace(c, 1, p.epsN, 4000, createSeededRng(deriveSeed(p.seed, 'nD')));
    const sDp = simulateLaplace(c - 1, 1, p.epsN, 4000, createSeededRng(deriveSeed(p.seed, 'nDp')));
    const hD = histogram(sD.releases, 40, [lo, hi]);
    const hDp = histogram(sDp.releases, 40, [lo, hi]);
    const dens = hD.map((h, i) => ({ x: h.mid, empD: h.density, empDp: hDp[i].density, pdfD: laplacePdf(h.mid, c, b), pdfDp: laplacePdf(h.mid, c - 1, b) }));
    const loss = Array.from({ length: 121 }, (_, i) => {
      const x = lo + ((hi - lo) * i) / 120;
      return { x, perdida: laplacePrivacyLoss(x, c, c - 1, b) };
    });
    return { b, dens, loss };
  }, [ok, p.count, p.epsN, p.seed]);

  // --- Sensibilidad: media acotada ---
  const ages = useMemo(() => (ok ? syntheticAges(p.n, p.seed) : []), [ok, p.n, p.seed]);
  const meanRes = useMemo(() => (ok ? meanReleaseError(ages, p.lower, p.upper, p.epsM, 1500, p.seed) : null), [ok, ages, p.lower, p.upper, p.epsM, p.seed]);
  const boundSweep = useMemo(() => {
    if (!ok) return [];
    const Us: number[] = [];
    for (let U = Math.max(p.lower + 5, 30); U <= 400; U += U < 120 ? 5 : 20) Us.push(U);
    return Us.map((U) => {
      const r = meanReleaseError(ages, p.lower, U, p.epsM, 400, p.seed);
      return { U, total: r.totalMAE, sesgo: Math.abs(r.bias), ruido: r.b };
    });
  }, [ok, ages, p.lower, p.epsM, p.seed]);

  const execute = async () => {
    if (!ok) return;
    setRunning(true);
    setError(null);
    try {
      const rows = await runSimTask('dpUtilitySweep', { epsilons: EPSILONS, sensitivity: 1, trueValue: p.count, reps: p.reps, seed: p.seed });
      setSweep({ rows, reps: p.reps, seed: p.seed });
      const results: Record<string, number> = {};
      rows.forEach((r) => (results[`EAM ε=${r.epsilon}`] = r.mae));
      if (meanRes) {
        results['Δ media acotada'] = meanRes.delta;
        results['Sesgo por recorte'] = meanRes.bias;
        results['EAM total media'] = meanRes.totalMAE;
      }
      addRun({
        experimentTitle: TITLE,
        seed: p.seed,
        params: toLabeled(p, LABELS),
        results,
        assumptions: [
          'Conteo con Δ = 1; ruido Laplace(0, 1/ε).',
          'Media acotada: vecindad por reemplazo, n público, valores recortados a [L, U] públicos, Δ = (U − L)/n.',
        ],
        limitations: ['Errores medidos empíricamente con un PRNG con semilla.', 'Edades sintéticas.'],
        privacyGuarantee: 'Cada publicación individual es ε-DP pura para su ε (bajo supuestos). Las repeticiones son didácticas y no constituyen una publicación real.',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const errorRows = sweep?.rows.map((r) => ({ ...r, band: [r.errP10, r.errP90] as [number, number] }));

  return (
    <ExperimentLayout
      experimentId={ID}
      module="dp"
      kicker="Experimento 3"
      title={TITLE}
      objective="Descubrir empíricamente que una privacidad más fuerte (ε menor) exige más ruido para la misma consulta y sensibilidad, y comprender por qué la sensibilidad —y los supuestos que la fijan— determinan la utilidad."
      badges={['real', 'empirical', 'formal']}
      intro={
        <>
          <p>
            Una agencia estadística debe decidir con qué ε publica. Con ε = 10 sus cifras son casi exactas; con ε = 0,1 son mucho más ruidosas. ¿Cuánto error cuesta cada nivel de privacidad? Aquí lo medimos
            repitiendo el mecanismo muchas veces y promediando el error absoluto.
          </p>
          <p>
            Pero el ruido no depende solo de ε, sino de la <Term k="sensitivity">sensibilidad</Term>. Una media es mucho menos sensible que un conteo si hay muchas personas, <em>siempre que</em> los valores
            estén acotados en un rango público [L, U]. Sin límites, una sola persona con un valor enorme podría mover la media arbitrariamente y ningún ruido finito bastaría.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="Barrido ε vs error">
            <p className="text-[11px] text-muted-foreground">ε evaluados: {EPSILONS.join(', ')}</p>
            <ParamSlider label="Conteo verdadero" ariaLabel="Conteo verdadero" value={p.count} min={1} max={1000} step={1} onChange={(count) => set({ count })} />
            <ParamSlider label="Repeticiones por ε" ariaLabel="Repeticiones por épsilon" value={p.reps} min={100} max={20000} step={100} onChange={(reps) => set({ reps })} />
            <SeedControl value={p.seed} onChange={(seed) => set({ seed })} />
          </ConfigSection>
          <ConfigSection title="Conjuntos vecinos">
            <ParamSlider label={<Term k="epsilon">ε para la comparación</Term>} ariaLabel="Épsilon para la comparación de vecinos" value={p.epsN} min={0.05} max={10} step={0.05} log onChange={(epsN) => set({ epsN })} />
          </ConfigSection>
          <ConfigSection title="Media acotada (sensibilidad)">
            <ParamSlider label="n (personas)" ariaLabel="Número de personas" value={p.n} min={5} max={2000} step={1} onChange={(n) => set({ n })} />
            <ParamSlider label="Límite inferior público L" ariaLabel="Límite inferior" value={p.lower} min={0} max={100} step={1} onChange={(lower) => set({ lower })} validate={(v) => (v >= p.upper ? 'L debe ser menor que U.' : null)} />
            <ParamSlider label="Límite superior público U" ariaLabel="Límite superior" value={p.upper} min={10} max={400} step={1} onChange={(upper) => set({ upper })} validate={(v) => (v <= p.lower ? 'U debe ser mayor que L.' : null)} />
            <ParamSlider label="ε para la media" ariaLabel="Épsilon para la media" value={p.epsM} min={0.05} max={10} step={0.05} log onChange={(epsM) => set({ epsM })} />
          </ConfigSection>
          <ErrorList errors={errors} />
          {error && <ErrorList errors={[error]} />}
          <Button variant="dp" className="w-full" disabled={!ok || running} onClick={execute}>
            {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? 'Calculando…' : 'Ejecutar barrido y registrar'}
          </Button>
          <p className="text-[11px] text-muted-foreground">El barrido se ejecuta en un Web Worker para no bloquear la interfaz. Los gráficos de vecinos y de sensibilidad se recalculan al instante.</p>
        </>
      }
      visual={
        <>
          <VisualCard title="1 · Error absoluto medio frente a ε" description="Conteo con sensibilidad 1" actions={<IntegrityBadge kind="empirical" />}>
            {errorRows ? (
              <ChartFrame
                title="Error absoluto medio de las publicaciones según ε"
                description={`Puntos: media empírica sobre ${sweep!.reps} repeticiones (barras = IC 95 %). Banda: percentiles 10–90 del error. Línea discontinua: valor teórico E|Z| = 1/ε. Eje x logarítmico.`}
                data={sweep!.rows}
                columns={[
                  { key: 'epsilon', label: 'ε' },
                  { key: 'scale', label: 'b = 1/ε' },
                  { key: 'mae', label: 'EAM empírico' },
                  { key: 'maeCi95', label: '± IC 95 %' },
                  { key: 'errP10', label: 'P10' },
                  { key: 'errP90', label: 'P90' },
                  { key: 'theoreticalMAE', label: 'EAM teórico' },
                ]}
                height={300}
              >
                <ComposedChart data={errorRows} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="epsilon" type="number" scale="log" domain={[0.08, 12]} ticks={EPSILONS} tickFormatter={fmtNum(2)} {...axisProps} label={{ value: 'ε (escala log)', position: 'insideBottom', offset: -8, fontSize: 11, fill: C.axis }} />
                  <YAxis tickFormatter={fmtNum(2)} {...axisProps} width={50} label={{ value: 'Error absoluto', angle: -90, position: 'insideLeft', fontSize: 11, fill: C.axis }} />
                  <Tooltip {...tooltipProps} formatter={(v: unknown) => (Array.isArray(v) ? v.map((x) => fmtNum(3)(x)).join(' – ') : fmtNum(3)(v))} labelFormatter={(l) => `ε = ${l}`} />
                  <Legend {...legendProps} verticalAlign="top" />
                  <Area dataKey="band" name="P10–P90" stroke="none" fill={C.dp} fillOpacity={0.15} isAnimationActive={false} />
                  <Line dataKey="theoreticalMAE" name="Teórico 1/ε" stroke={C.c1} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="mae" name="EAM empírico" stroke={C.dp} strokeWidth={2} isAnimationActive={false}>
                    <ErrorBar dataKey="maeCi95" width={4} stroke={C.dp} />
                  </Line>
                </ComposedChart>
              </ChartFrame>
            ) : (
              <p className="text-sm text-muted-foreground">Pulsa «Ejecutar barrido» para medir el error en cada ε.</p>
            )}
          </VisualCard>
          {neigh && (
            <VisualCard title="2 · Distribución de resultados en conjuntos vecinos" description={`D: conteo ${p.count}; D′: conteo ${p.count - 1} (una persona menos). ε = ${f(p.epsN)}`} actions={<><IntegrityBadge kind="real" /><IntegrityBadge kind="formal" /></>}>
              <ChartFrame
                title="Densidad de M(D) y M(D′)"
                description="Áreas: histogramas empíricos (4000 muestras cada uno). Líneas: densidades de Laplace teóricas. Cuanto más se solapan, más difícil es distinguir si la persona está."
                data={neigh.dens}
                columns={[
                  { key: 'x', label: 'Resultado' },
                  { key: 'empD', label: 'Empírica D' },
                  { key: 'empDp', label: "Empírica D′" },
                  { key: 'pdfD', label: 'Teórica D' },
                  { key: 'pdfDp', label: "Teórica D′" },
                ]}
              >
                <ComposedChart data={neigh.dens} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtNum(1)} {...axisProps} />
                  <YAxis tickFormatter={fmtNum(3)} {...axisProps} width={50} />
                  <Tooltip {...tooltipProps} formatter={fmtNum(4)} labelFormatter={fmtNum(2)} />
                  <Legend {...legendProps} />
                  <Area type="step" dataKey="empD" name="Empírica D" stroke="none" fill={C.dp} fillOpacity={0.2} isAnimationActive={false} />
                  <Area type="step" dataKey="empDp" name="Empírica D′" stroke="none" fill={C.c4} fillOpacity={0.2} isAnimationActive={false} />
                  <Line dataKey="pdfD" name="Teórica D" stroke={C.dp} dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="pdfDp" name="Teórica D′" stroke={C.c4} dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ChartFrame>
              <div className="mt-4">
                <ChartFrame
                  title="Pérdida de privacidad ln(p_D(x) / p_D′(x))"
                  description={`Para cualquier resultado x, el logaritmo del cociente de densidades queda dentro de la banda [−ε, +ε] = [−${f(p.epsN)}, ${f(p.epsN)}]: esa es la garantía de Laplace.`}
                  height={200}
                  data={neigh.loss.filter((_, i) => i % 6 === 0)}
                  columns={[
                    { key: 'x', label: 'Resultado x' },
                    { key: 'perdida', label: 'Pérdida' },
                  ]}
                >
                  <LineChart data={neigh.loss} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtNum(1)} {...axisProps} />
                    <YAxis domain={[-p.epsN * 1.4, p.epsN * 1.4]} tickFormatter={fmtNum(2)} {...axisProps} width={50} />
                    <Tooltip {...tooltipProps} formatter={fmtNum(4)} labelFormatter={fmtNum(2)} />
                    <ReferenceArea y1={-p.epsN} y2={p.epsN} fill={C.ok} fillOpacity={0.08} />
                    <ReferenceLine y={p.epsN} stroke={C.ok} strokeDasharray="4 3" label={{ value: '+ε', fontSize: 11, fill: C.ok, position: 'right' }} />
                    <ReferenceLine y={-p.epsN} stroke={C.ok} strokeDasharray="4 3" label={{ value: '−ε', fontSize: 11, fill: C.ok, position: 'right' }} />
                    <Line dataKey="perdida" name="Pérdida de privacidad" stroke={C.dp} dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ChartFrame>
              </div>
            </VisualCard>
          )}
          {meanRes && (
            <VisualCard title="3 · La sensibilidad importa: media de edad acotada" description={`n = ${p.n} edades sintéticas · límites públicos [${p.lower}, ${p.upper}] · ε = ${f(p.epsM)}`} actions={<IntegrityBadge kind="empirical" />}>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Media real" value={f(meanRes.trueMean, 2)} />
                <StatTile label="Media recortada" value={f(meanRes.clamped, 2)} sub={`sesgo ${f(meanRes.bias, 2)}`} tone={Math.abs(meanRes.bias) > 0.5 ? 'warn' : undefined} />
                <StatTile label="Δ = (U − L)/n" value={f(meanRes.delta, 4)} tone="dp" />
                <StatTile label="Error abs. medio total" value={f(meanRes.totalMAE, 3)} sub={`ruido b = ${f(meanRes.b, 3)}`} />
              </div>
              <ChartFrame
                title="Error total según el límite superior U"
                description={`Con L = ${p.lower} fijo. U pequeño: poco ruido pero sesgo por recortar edades reales. U grande: sin sesgo pero más ruido (Δ crece). La línea vertical marca tu U.`}
                data={boundSweep}
                columns={[
                  { key: 'U', label: 'U' },
                  { key: 'total', label: 'Error total medio' },
                  { key: 'sesgo', label: '|Sesgo|' },
                  { key: 'ruido', label: 'Escala ruido b' },
                ]}
              >
                <LineChart data={boundSweep} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="U" type="number" domain={['dataMin', 'dataMax']} {...axisProps} label={{ value: 'Límite superior U', position: 'insideBottom', offset: -8, fontSize: 11, fill: C.axis }} />
                  <YAxis tickFormatter={fmtNum(2)} {...axisProps} width={50} />
                  <Tooltip {...tooltipProps} formatter={fmtNum(3)} labelFormatter={(l) => `U = ${l}`} />
                  <Legend {...legendProps} verticalAlign="top" />
                  <Line dataKey="total" name="Error total (empírico)" stroke={C.dp} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="sesgo" name="|Sesgo| por recorte" stroke={C.c4} dot={false} isAnimationActive={false} />
                  <Line dataKey="ruido" name="Escala del ruido b" stroke={C.c1} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <ReferenceLine x={p.upper} stroke={C.fg} strokeDasharray="3 3" />
                </LineChart>
              </ChartFrame>
            </VisualCard>
          )}
        </>
      }
      observations={
        <>
          {sweep ? (
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="EAM con ε = 0,1" value={f(sweep.rows[0].mae, 2)} tone="dp" sub="privacidad fuerte" />
              <StatTile label={`EAM con ε = ${EPSILONS[EPSILONS.length - 1]}`} value={f(sweep.rows[sweep.rows.length - 1].mae, 3)} sub="privacidad débil" />
            </div>
          ) : null}
          <Callout kind="info" title="Patrón esperado">
            Para la misma consulta y sensibilidad, el error esperado es b = Δ/ε: dividir ε por 10 multiplica el error por 10. Los valores empíricos fluctúan alrededor de la curva teórica.
          </Callout>
          {neigh && (
            <p className="text-[13px] leading-relaxed">
              Con ε = {f(p.epsN)}, las densidades de D y D′ difieren como mucho en un factor e^ε = {f(Math.exp(p.epsN), 3)} en cualquier punto. Un observador no puede decidir con seguridad si la persona está, sea cual sea el
              resultado.
            </p>
          )}
          <Callout kind="warn" title="La garantía es del mecanismo completo">
            Δ = (U − L)/n solo es válida si los límites son públicos y fijados sin mirar los datos, si n es público y si se recorta antes de promediar. Elegir L y U a partir de los datos (p. ej. usando el máximo real) filtra
            información que no está contabilizada.
          </Callout>
          {meanRes && Math.abs(meanRes.bias) > 0.5 && (
            <Callout kind="warn">Tus límites recortan edades reales: el sesgo ({f(meanRes.bias, 2)}) es un error que el ruido no compensa.</Callout>
          )}
        </>
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => setP(fromLabeled(r.params, LABELS, DEFAULTS))} onReset={reset} />}
      details={
        meanRes && (
          <ShowCalculations
            equations={[
              'Conteo: b = 1/ε,  E|Z| = b',
              'Media acotada: x̃ᵢ = min(U, max(L, xᵢ)),  f(D) = (1/n) Σ x̃ᵢ',
              'Δ = (U − L)/n  (vecindad por reemplazo, n público)',
              'M(D) = f(D) + Lap(Δ/ε)',
              'Pérdida: L(x) = ln[p_D(x)/p_D′(x)] = (|x − f(D′)| − |x − f(D)|)/b ∈ [−ε, ε]',
            ]}
            inputs={[
              { label: 'n', value: p.n },
              { label: '[L, U]', value: `[${p.lower}, ${p.upper}]` },
              { label: 'ε (media)', value: f(p.epsM, 4) },
              { label: 'Semilla', value: p.seed },
            ]}
            intermediates={[
              { label: 'Media real (sin recortar)', value: f(meanRes.trueMean, 4) },
              { label: 'Media recortada f(D)', value: f(meanRes.clamped, 4) },
              { label: 'Personas recortadas', value: ages.filter((a) => a < p.lower || a > p.upper).length },
              { label: 'Δ', value: f(meanRes.delta, 6) },
              { label: 'b = Δ/ε', value: f(meanRes.b, 6) },
            ]}
            outputs={[
              { label: 'Sesgo', value: f(meanRes.bias, 4) },
              { label: 'Error abs. medio total (1500 rep.)', value: f(meanRes.totalMAE, 4) },
              ...(sweep ? sweep.rows.map((r) => ({ label: `EAM conteo, ε = ${r.epsilon}`, value: f(r.mae, 4) })) : []),
            ]}
            assumptions={boundedMeanSensitivity(p.lower, p.upper, p.n).assumptions}
          />
        )
      }
      prosCons={{
        benefits: [
          'El coste de privacidad es cuantificable y predecible: error ∝ Δ/ε.',
          'Las consultas de baja sensibilidad (medias sobre muchas personas) pueden publicarse con poco error.',
          'Los límites públicos convierten consultas no acotadas en consultas con garantía.',
        ],
        limitations: [
          'Con pocos datos o ε pequeño, el ruido puede hacer inútil el resultado.',
          'Elegir límites es un compromiso: estrechos ⇒ sesgo; amplios ⇒ ruido.',
          'La sensibilidad depende de la definición de vecinos (añadir/eliminar frente a reemplazar).',
        ],
      }}
      reflection={{
        question: 'Fija n = 50 y mueve U desde 60 hasta 300. ¿Dónde está el U que minimiza el error total? ¿Podrías elegirlo mirando los datos privados sin violar la garantía? ¿Qué harías en su lugar?',
        hint: 'Elegir U mirando los datos es en sí un uso de los datos que no está cubierto por ε. Alternativas: usar conocimiento del dominio (edad ≤ 100), datos públicos, o gastar parte del presupuesto en estimar privadamente un cuantil.',
      }}
    />
  );
}
