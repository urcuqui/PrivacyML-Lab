import { useId, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Play } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { AdjacencyChoice, ContextualCheck, PrivacyModelCard } from '@/components/lab/PrivacyModel';
import { dpsgdSpec, type Adjacency } from '@/lib/privacy/model';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps, fmtNum } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { privacyRecord, useRuns } from '@/lib/runs';
import { createSeededRng, deriveSeed } from '@/lib/rng/rng';
import { generateBlobs, splitTrainTest, type Sample } from '@/lib/ml/logistic';
import { maxParticipationsPerRecord, trainLogistic, validateDpsgdConfig, type StepTrace, type TrainResult } from '@/lib/dp/dpsgd';
import { norm2, type Vec } from '@/lib/vec';
import { f, fromLabeled, toLabeled } from './common';

const ID = 'dp5';
const TITLE = '¿Puede la DP proteger el entrenamiento de modelos?';
const DELTA = 1e-5;

type Params = { n: number; learningRate: number; batchSize: number; steps: number; clipNorm: number; noiseMultiplier: number; seed: number; adjacency: Adjacency };
const DEFAULTS: Params = { n: 400, learningRate: 0.5, batchSize: 32, steps: 200, clipNorm: 1, noiseMultiplier: 1, seed: 7, adjacency: 'add-remove' };
const LABELS: Record<keyof Params, string> = {
  n: 'Tamaño del conjunto (n)',
  learningRate: 'Tasa de aprendizaje η',
  batchSize: 'Tamaño de lote B',
  steps: 'Pasos de entrenamiento',
  clipNorm: 'Norma de recorte C',
  noiseMultiplier: 'Multiplicador de ruido σ',
  seed: 'Semilla',
  adjacency: 'Vecindad (adjacency)',
};

const adjOf = (p: Params): Adjacency => (p.adjacency === 'replace' ? 'replace' : 'add-remove');

interface Result {
  params: Params;
  train: Sample[];
  test: Sample[];
  sgd: TrainResult;
  dp: TrainResult;
}

function makeData(p: Params) {
  const rng = createSeededRng(deriveSeed(p.seed, 'data', p.n));
  return splitTrainTest(generateBlobs(p.n, rng, { sd: 1.2 }), 0.25, rng);
}

function validate(p: Params): string[] {
  const e: string[] = [];
  if (!Number.isInteger(p.n) || p.n < 40 || p.n > 3000) e.push('n debe estar entre 40 y 3000.');
  if (!Number.isInteger(p.steps) || p.steps > 2000) e.push('Los pasos deben ser como máximo 2000.');
  const nTrain = p.n - Math.round(p.n * 0.25);
  e.push(...validateDpsgdConfig({ ...p }, nTrain));
  return e;
}

/** Recorta la recta w1·x + w2·y + b = 0 a la caja [−L, L]². */
function boundarySegment(w: Vec, L = 4.5): { x: number; y: number }[] {
  const [w1, w2, b] = w;
  const pts: { x: number; y: number }[] = [];
  if (Math.abs(w2) > 1e-9) {
    for (const x of [-L, L]) {
      const y = -(w1 * x + b) / w2;
      if (y >= -L && y <= L) pts.push({ x, y });
    }
  }
  if (Math.abs(w1) > 1e-9) {
    for (const y of [-L, L]) {
      const x = -(w2 * y + b) / w1;
      if (x >= -L && x <= L) pts.push({ x, y });
    }
  }
  const uniq = pts.filter((p, i) => pts.findIndex((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9) === i);
  return uniq.slice(0, 2);
}

function Arrow({ x1, y1, x2, y2, color, width = 1.5, opacity = 1, marker, dash }: { x1: number; y1: number; x2: number; y2: number; color: string; width?: number; opacity?: number; marker: string; dash?: string }) {
  return (
    <motion.line
      initial={{ x2: x1, y2: y1 }}
      animate={{ x2, y2 }}
      transition={{ duration: 0.5 }}
      x1={x1}
      y1={y1}
      stroke={color}
      strokeWidth={width}
      strokeOpacity={opacity}
      strokeDasharray={dash}
      markerEnd={`url(#${marker})`}
      style={{ color }}
    />
  );
}

function GradientViz({ trace, C: clip, B, lr }: { trace: StepTrace; C: number; B: number; lr: number }) {
  const uid = useId().replace(/:/g, '');
  const mk = (n: string) => `${uid}-${n}`;
  const show = trace.perExample.slice(0, 24);
  const W = 300;
  const c = W / 2;
  const maxR = Math.max(clip, ...show.map((pe) => Math.hypot(pe.grad[0], pe.grad[1]))) * 1.1;
  const s = (c - 10) / maxR;
  const mean = trace.gradSum.map((g) => g / B);
  const noise = trace.noise ? trace.noise.map((z) => z / B) : [0, 0, 0];
  const fin = trace.finalGrad;
  const maxR2 = Math.max(Math.hypot(mean[0], mean[1]), Math.hypot(fin[0], fin[1]), Math.hypot(mean[0] + noise[0], mean[1] + noise[1]), 1e-6) * 1.15;
  const s2 = (c - 10) / maxR2;
  const markers = (
    <defs>
      {['g', 'c', 'm', 'n', 'f'].map((n) => (
        <marker key={n} id={mk(n)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      ))}
    </defs>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <figure>
        <svg viewBox={`0 0 ${W} ${W}`} className="w-full max-w-[340px]" role="img" aria-label={`Gradientes por ejemplo del paso ${trace.step}: originales en gris y recortados a norma ${clip} en color. Círculo de radio C.`}>
          {markers}
          <line x1={0} x2={W} y1={c} y2={c} stroke={C.grid} />
          <line y1={0} y2={W} x1={c} x2={c} stroke={C.grid} />
          <circle cx={c} cy={c} r={clip * s} fill={C.dp} fillOpacity={0.06} stroke={C.dp} strokeDasharray="4 3" />
          <text x={c + clip * s * 0.72} y={c - clip * s * 0.72 - 4} fontSize={10} fill={C.dp}>C = {f(clip)}</text>
          {show.map((pe, i) => (
            <g key={i}>
              <Arrow x1={c} y1={c} x2={c + pe.grad[0] * s} y2={c - pe.grad[1] * s} color={C.muted} opacity={0.5} marker={mk('g')} width={1} />
              <Arrow x1={c} y1={c} x2={c + pe.clipped[0] * s} y2={c - pe.clipped[1] * s} color={pe.wasClipped ? C.c5 : C.c2} marker={mk('c')} width={1.6} />
            </g>
          ))}
          <text x={6} y={14} fontSize={10} fill={C.axis}>∂/∂w₂ ↑</text>
          <text x={W - 50} y={c - 6} fontSize={10} fill={C.axis}>∂/∂w₁ →</text>
        </svg>
        <figcaption className="text-[11px] text-muted-foreground">
          1–2. Gradientes por ejemplo (componentes w₁, w₂). Gris: original. Rojo: recortado (norma &gt; C). Verde: sin cambios. El recorte usa la norma de los 3 parámetros (incluido el sesgo), así que en proyección 2D un vector
          recortado puede quedar dentro del círculo.
        </figcaption>
      </figure>
      <figure>
        <svg viewBox={`0 0 ${W} ${W}`} className="w-full max-w-[340px]" role="img" aria-label="Agregación: media de gradientes recortados, ruido gaussiano añadido y gradiente final">
          {markers}
          <line x1={0} x2={W} y1={c} y2={c} stroke={C.grid} />
          <line y1={0} y2={W} x1={c} x2={c} stroke={C.grid} />
          <Arrow x1={c} y1={c} x2={c + mean[0] * s2} y2={c - mean[1] * s2} color={C.c1} marker={mk('m')} width={2.5} />
          {trace.noise && <Arrow x1={c + mean[0] * s2} y1={c - mean[1] * s2} x2={c + (mean[0] + noise[0]) * s2} y2={c - (mean[1] + noise[1]) * s2} color={C.warn} marker={mk('n')} width={2} dash="4 3" />}
          <Arrow x1={c} y1={c} x2={c + fin[0] * s2} y2={c - fin[1] * s2} color={C.dp} marker={mk('f')} width={3} />
          <Arrow x1={c} y1={c} x2={c - lr * fin[0] * s2} y2={c + lr * fin[1] * s2} color={C.ok} marker={mk('g')} width={2} dash="2 2" />
        </svg>
        <figcaption className="space-y-0.5 text-[11px] text-muted-foreground">
          <div><span className="font-semibold" style={{ color: C.c1 }}>Azul</span>: 3. suma de recortados / B = ({f(mean[0])}, {f(mean[1])})</div>
          {trace.noise && <div><span className="font-semibold" style={{ color: C.warn }}>Naranja</span>: 4. ruido / B = ({f(noise[0])}, {f(noise[1])})</div>}
          <div><span className="font-semibold" style={{ color: C.dp }}>Violeta</span>: gradiente final ({f(fin[0])}, {f(fin[1])})</div>
          <div><span className="font-semibold" style={{ color: C.ok }}>Verde</span>: 5. dirección de la actualización −η·g (escala distinta)</div>
        </figcaption>
      </figure>
    </div>
  );
}

/** Pregunta contextual: ¿qué pasa si C es demasiado pequeño? (explicación basada en los resultados reales). */
function ClipCheck({ res }: { res: Result }) {
  const [alt, setAlt] = useState<{ C: number; acc: number; loss: number; clipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const last = (r: TrainResult) => r.history[r.history.length - 1];
  const P = res.params;
  const accSgd = last(res.sgd).testAcc;
  const accDp = last(res.dp).testAcc;
  const gap = accSgd - accDp;
  const trace = res.dp.traces[0];
  const meanClipped = trace ? trace.perExample.reduce((s, q) => s + q.clippedNorm, 0) / trace.perExample.length : NaN;
  const meanRaw = trace ? trace.perExample.reduce((s, q) => s + q.norm, 0) / trace.perExample.length : NaN;
  const noisePerCoord = (P.noiseMultiplier * P.clipNorm) / P.batchSize;
  const signal = trace ? Math.hypot(...trace.gradSum) / P.batchSize : NaN;
  const runAlt = () => {
    setBusy(true);
    setTimeout(() => {
      const C2 = P.clipNorm / 10;
      const r = trainLogistic('dpsgd', res.train, res.test, { ...P, clipNorm: C2, adjacency: adjOf(P), delta: DELTA });
      setAlt({ C: C2, acc: last(r).testAcc, loss: last(r).testLoss, clipped: r.clippedFraction });
      setBusy(false);
    }, 10);
  };
  return (
    <ContextualCheck
      question="¿Qué sucede cuando disminuimos demasiado el clipping norm?"
      explanation={
        <>
          <p>
            En tu ejecución (C = {f(P.clipNorm)}, σ = {f(P.noiseMultiplier)}, B = {P.batchSize}) se recortó el <strong>{f(res.dp.clippedFraction * 100, 1)} %</strong> de los gradientes por ejemplo. En el primer paso,
            la norma media era {f(meanRaw, 3)} antes del recorte y {f(meanClipped, 3)} después. La precisión de prueba fue {f(accSgd * 100, 1)} % con SGD y {f(accDp * 100, 1)} % con DP-SGD (diferencia{' '}
            {f(gap * 100, 1)} puntos).
          </p>
          <p>
            Ruido por coordenada en el gradiente medio: σC/B = {f(noisePerCoord, 4)}, frente a una señal ‖Σḡ‖/B = {f(signal, 4)} en el primer paso.{' '}
            {res.dp.clippedFraction > 0.8
              ? 'Casi todos los gradientes se recortan: el gradiente medio pierde magnitud (como si la tasa de aprendizaje efectiva bajara) y los ejemplos dejan de pesar según su error, lo que introduce sesgo.'
              : res.dp.clippedFraction < 0.1
                ? 'Muy pocos gradientes se recortan: C apenas limita la influencia individual, pero el ruido σC es grande en relación con gradientes que son menores que C.'
                : 'Una parte de los gradientes se recorta: C equilibra el sesgo (recortar) y el ruido (proporcional a C).'}
          </p>
          <p>
            Al reducir C, el ruido σC también se reduce en la misma proporción; por eso, una vez que casi todo se recorta, la relación señal/ruido por paso deja de mejorar, mientras que el sesgo (pérdida de magnitud y de la
            ponderación por error) aumenta. El ε no cambia con C: depende de σ, de los pasos y de la vecindad.
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={runAlt}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Calcular con C/10 (mismo σ, misma semilla)
          </Button>
          {alt && (
            <p className="rounded-md bg-muted p-2 text-xs" aria-live="polite">
              Con C = {f(alt.C, 4)}: recortados {f(alt.clipped * 100, 1)} %, precisión de prueba {f(alt.acc * 100, 1)} % (pérdida {f(alt.loss, 3)}), frente a {f(accDp * 100, 1)} % con C = {f(P.clipNorm)}.{' '}
              {alt.acc < accDp - 0.01
                ? 'En esta configuración, el recorte más agresivo empeoró la precisión.'
                : alt.acc > accDp + 0.01
                  ? 'En esta configuración la precisión mejoró: el menor ruido absoluto compensó el sesgo (con más pasos o una η mayor el resultado puede cambiar).'
                  : 'En esta configuración la precisión apenas cambió (diferencia ≤ 1 punto); fíjate en la pérdida y en la fracción recortada.'}
            </p>
          )}
        </>
      }
    />
  );
}

export default function DP5DPSGD() {
  const [p, setP, reset] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [res, setRes] = usePersistentState<Result | null>(`${ID}.result`, null, false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [traceIdx, setTraceIdx] = useState(0);
  const { addRun } = useRuns(ID);
  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));
  const errors = validate(p);
  const nTrain = p.n - Math.round(p.n * 0.25);

  const execute = () => {
    if (errors.length) return;
    setRunning(true);
    setRunError(null);
    setTimeout(() => {
      try {
        const { train, test } = makeData(p);
        const cfg = { ...p, adjacency: adjOf(p), delta: DELTA };
        const sgd = trainLogistic('sgd', train, test, cfg, { traceFirst: 3 });
        const dp = trainLogistic('dpsgd', train, test, cfg, { traceFirst: 3 });
        setRes({ params: p, train, test, sgd, dp });
        setTraceIdx(0);
        const last = (r: TrainResult) => r.history[r.history.length - 1];
        addRun({
          experimentTitle: TITLE,
          seed: p.seed,
          params: toLabeled(p, LABELS),
          results: {
            'Precisión test SGD': last(sgd).testAcc,
            'Precisión test DP-SGD': last(dp).testAcc,
            'Pérdida test SGD': last(sgd).testLoss,
            'Pérdida test DP-SGD': last(dp).testLoss,
            'Fracción de gradientes recortados': dp.clippedFraction,
            'ε (δ = 1e-5)': dp.accounting.status === 'computed' ? dp.accounting.epsilon : 'No calculado',
          },
          assumptions: ['Regresión logística con 2 características; datos sintéticos de dos nubes gaussianas.', 'DP-SGD: gradientes por ejemplo, recorte L2 a C, ruido N(0, σ²C²) sobre la suma, división por B público.'],
          limitations: [
            'Demostración pedagógica, no una implementación certificada.',
            'Lotes por barajado, no muestreo de Poisson.',
            'PRNG con semilla, no seguro; la selección de hiperparámetros no está contabilizada.',
          ],
          privacyGuarantee:
            dp.accounting.status === 'computed'
              ? `(${f(dp.accounting.epsilon, 3)}, ${DELTA})-DP a nivel de registro (vecindad ${adjOf(p) === 'replace' ? 'por reemplazo' : 'añadir/eliminar'}), cota RDP conservadora sin amplificación con ${dp.accounting.details.compositions} composiciones, bajo los supuestos indicados.`
              : `No calculado: ${dp.accounting.reason}`,
          privacy: privacyRecord(dpsgdSpec(adjOf(p)), dp.accounting, { clipNorm: p.clipNorm, noiseMultiplier: p.noiseMultiplier }),
        });
      } catch (e) {
        setRunError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    }, 20);
  };

  const curves = useMemo(
    () =>
      res
        ? res.sgd.history.map((h, i) => ({
            step: h.step,
            sgdLoss: h.trainLoss,
            dpLoss: res.dp.history[i]?.trainLoss,
            sgdAcc: h.testAcc,
            dpAcc: res.dp.history[i]?.testAcc,
          }))
        : [],
    [res],
  );
  const scatter = useMemo(() => {
    if (!res) return null;
    const pts = res.test.map((s) => ({ x: s.x[0], y: s.x[1], y_: s.y }));
    return { c0: pts.filter((q) => q.y_ === 0), c1: pts.filter((q) => q.y_ === 1), sgdLine: boundarySegment(res.sgd.params), dpLine: boundarySegment(res.dp.params) };
  }, [res]);

  const last = (r: TrainResult) => r.history[r.history.length - 1];
  const trace = res?.dp.traces[traceIdx];
  const acc = res?.dp.accounting;
  const stale = res && JSON.stringify(res.params) !== JSON.stringify(p);

  return (
    <ExperimentLayout
      experimentId={ID}
      module="dp"
      kicker="Experimento 5"
      title={TITLE}
      objective="Comprender las operaciones esenciales de DP-SGD (gradientes por ejemplo, recorte, ruido gaussiano), su efecto en la precisión del modelo y por qué el ε de un entrenamiento solo puede declararse con un contador de privacidad válido."
      badges={['real', 'sim', acc?.status === 'computed' ? 'formal' : 'not-computed']}
      intro={
        <>
          <p>
            Un modelo entrenado con datos de pacientes puede memorizar detalles de algunos de ellos. Si un paciente es atípico, su gradiente puede ser muy grande y «tirar» del modelo hacia él. DP-SGD limita esa influencia: cada
            ejemplo empuja como mucho con fuerza C y, además, se añade ruido que oculta la presencia de cualquier ejemplo concreto.
          </p>
          <p>
            En cada paso: (1) se calcula el gradiente de cada ejemplo por separado; (2) se <Term k="clipping">recorta</Term> su norma a C; (3) se suman; (4) se añade <Term k="gaussian">ruido gaussiano</Term> N(0, σ²C²) con{' '}
            <Term k="noiseMultiplier">multiplicador σ</Term>; (5) se divide por B y se actualizan los parámetros. La garantía (ε, δ) del entrenamiento completo requiere un <Term k="accountant">contador de privacidad</Term>.
          </p>
          <Callout kind="warn" title="Demostración pedagógica">
            Este es un DP-SGD real en sus operaciones, pero sobre un modelo de 3 parámetros y datos sintéticos, con aleatoriedad no segura. No es una implementación certificada (como Opacus o TensorFlow Privacy).
          </Callout>
        </>
      }
      config={
        <>
          <ConfigSection title="Datos y modelo">
            <ParamSlider label="Tamaño del conjunto (n)" ariaLabel="Tamaño del conjunto" value={p.n} min={40} max={3000} step={10} onChange={(n) => set({ n })} help={`75 % entrenamiento (${nTrain}), 25 % prueba.`} />
            <ParamSlider label={<Term k="learningRate">Tasa de aprendizaje η</Term>} ariaLabel="Tasa de aprendizaje" value={p.learningRate} min={0.01} max={5} step={0.01} onChange={(learningRate) => set({ learningRate })} />
            <ParamSlider label={<Term k="batchSize">Tamaño de lote B</Term>} ariaLabel="Tamaño de lote" value={p.batchSize} min={1} max={nTrain} step={1} onChange={(batchSize) => set({ batchSize })} help={
                adjOf(p) === 'replace'
                  ? `Con reemplazo, cada registro participa en ≤ ⌈T/⌊n/B⌋⌉ = ${p.batchSize <= nTrain && p.batchSize >= 1 ? maxParticipationsPerRecord(nTrain, p.batchSize, Math.max(1, p.steps)) : '—'} pasos.`
                  : `Con añadir/eliminar solo B = ${nTrain} (lote completo) permite una cota formal de ε.`
              } />
            <ParamSlider label="Pasos de entrenamiento" ariaLabel="Pasos de entrenamiento" value={p.steps} min={1} max={2000} step={1} onChange={(steps) => set({ steps })} />
          </ConfigSection>
          <ConfigSection title="Privacidad (DP-SGD)">
            <ParamSlider label={<Term k="clipping">Norma de recorte C</Term>} ariaLabel="Norma de recorte" value={p.clipNorm} min={0.01} max={5} step={0.01} onChange={(clipNorm) => set({ clipNorm })} />
            <ParamSlider label={<Term k="noiseMultiplier">Multiplicador de ruido σ</Term>} ariaLabel="Multiplicador de ruido" value={p.noiseMultiplier} min={0} max={10} step={0.05} onChange={(noiseMultiplier) => set({ noiseMultiplier })} help={`Desv. típica del ruido sobre la suma: σ·C = ${f(p.noiseMultiplier * p.clipNorm)}; sobre la media: σ·C/B = ${f((p.noiseMultiplier * p.clipNorm) / Math.max(1, p.batchSize), 4)}.`} />
            <AdjacencyChoice value={adjOf(p)} onChange={(adjacency) => set({ adjacency })} unitLabel="registro (ejemplo)" />
            <SeedControl value={p.seed} onChange={(seed) => set({ seed })} />
            <Button size="sm" variant="outline" className="w-full" onClick={() => set({ batchSize: nTrain, steps: Math.min(p.steps, 100), learningRate: Math.max(p.learningRate, 1) })}>
              Usar lote completo (B = n de entrenamiento)
            </Button>
          </ConfigSection>
          <ErrorList errors={errors} />
          {runError && <ErrorList errors={[runError]} />}
          <Button variant="dp" className="w-full" disabled={errors.length > 0 || running} onClick={execute}>
            {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? 'Entrenando…' : 'Entrenar SGD y DP-SGD'}
          </Button>
        </>
      }
      visual={
        res && scatter ? (
          <>
            {stale && <Callout kind="warn">Los parámetros han cambiado desde el último entrenamiento. Pulsa «Entrenar» para actualizar.</Callout>}
            {trace && (
              <VisualCard
                title="Dentro de un paso de DP-SGD"
                description={`Paso ${trace.step}: ${trace.perExample.length} ejemplos en el lote${trace.perExample.length > 24 ? ' (se muestran 24)' : ''}`}
                actions={
                  <div role="tablist" aria-label="Paso inspeccionado" className="flex gap-1">
                    {res.dp.traces.map((t, i) => (
                      <Button key={t.step} role="tab" aria-selected={i === traceIdx} size="sm" variant={i === traceIdx ? 'default' : 'outline'} onClick={() => setTraceIdx(i)}>
                        Paso {t.step}
                      </Button>
                    ))}
                  </div>
                }
              >
                <GradientViz key={`${traceIdx}-${trace.step}`} trace={trace} C={res.params.clipNorm} B={res.params.batchSize} lr={res.params.learningRate} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Recortados en este paso" value={`${trace.perExample.filter((q) => q.wasClipped).length}/${trace.perExample.length}`} />
                  <StatTile label="‖suma recortada‖" value={f(norm2(trace.gradSum))} />
                  <StatTile label="‖ruido‖" value={trace.noise ? f(norm2(trace.noise)) : '0'} tone="warn" />
                  <StatTile label="‖actualización‖" value={f(norm2(trace.update), 4)} tone="dp" />
                </div>
              </VisualCard>
            )}
            <VisualCard title="Entrenamiento: SGD frente a DP-SGD" description="Mismos datos, misma secuencia de lotes y misma inicialización" actions={<IntegrityBadge kind="empirical" />}>
              <p className="mb-3 rounded-md bg-muted px-3 py-2 text-[11px] leading-snug">
                <strong>Instrumentación fuera de la garantía:</strong> la pérdida de entrenamiento se calcula sin ruido sobre los datos privados; en un despliegue real no se publicaría. El conjunto de prueba se trata como datos independientes NO protegidos. La garantía cubre solo los parámetros publicados θ₁…θ_T.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <ChartFrame
                  title="Pérdida de entrenamiento"
                  description="Entropía cruzada binaria sobre el conjunto de entrenamiento."
                  height={220}
                  data={curves}
                  columns={[
                    { key: 'step', label: 'Paso' },
                    { key: 'sgdLoss', label: 'SGD' },
                    { key: 'dpLoss', label: 'DP-SGD' },
                  ]}
                >
                  <LineChart data={curves} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="step" type="number" domain={['dataMin', 'dataMax']} {...axisProps} />
                    <YAxis tickFormatter={fmtNum(2)} {...axisProps} width={45} />
                    <Tooltip {...tooltipProps} formatter={fmtNum(4)} labelFormatter={(l) => `Paso ${l}`} />
                    <Legend {...legendProps} />
                    <Line dataKey="sgdLoss" name="SGD" stroke={C.c1} dot={false} isAnimationActive={false} />
                    <Line dataKey="dpLoss" name="DP-SGD" stroke={C.dp} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ChartFrame>
                <ChartFrame
                  title="Precisión en prueba"
                  description="Proporción de aciertos en el conjunto de prueba (25 %)."
                  height={220}
                  data={curves}
                  columns={[
                    { key: 'step', label: 'Paso' },
                    { key: 'sgdAcc', label: 'SGD' },
                    { key: 'dpAcc', label: 'DP-SGD' },
                  ]}
                >
                  <LineChart data={curves} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="step" type="number" domain={['dataMin', 'dataMax']} {...axisProps} />
                    <YAxis domain={[0.3, 1]} tickFormatter={fmtNum(2)} {...axisProps} width={45} />
                    <Tooltip {...tooltipProps} formatter={fmtNum(4)} labelFormatter={(l) => `Paso ${l}`} />
                    <Legend {...legendProps} />
                    <Line dataKey="sgdAcc" name="SGD" stroke={C.c1} dot={false} isAnimationActive={false} />
                    <Line dataKey="dpAcc" name="DP-SGD" stroke={C.dp} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ChartFrame>
              </div>
            </VisualCard>
            <VisualCard title="Fronteras de decisión finales" description="Puntos: conjunto de prueba. Líneas: w₁x₁ + w₂x₂ + b = 0 para cada modelo.">
              <ChartFrame
                title="Fronteras de decisión de SGD y DP-SGD"
                description="Clase 0 en gris, clase 1 en verde azulado. La línea azul es la frontera de SGD y la violeta la de DP-SGD."
                height={300}
                data={[
                  { modelo: 'SGD', w1: res.sgd.params[0], w2: res.sgd.params[1], b: res.sgd.params[2] },
                  { modelo: 'DP-SGD', w1: res.dp.params[0], w2: res.dp.params[1], b: res.dp.params[2] },
                ]}
                columns={[
                  { key: 'modelo', label: 'Modelo', format: (v) => String(v) },
                  { key: 'w1', label: 'w₁' },
                  { key: 'w2', label: 'w₂' },
                  { key: 'b', label: 'b' },
                ]}
              >
                <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="x" type="number" domain={[-4.5, 4.5]} name="x₁" {...axisProps} allowDataOverflow />
                  <YAxis dataKey="y" type="number" domain={[-4.5, 4.5]} name="x₂" {...axisProps} width={40} allowDataOverflow />
                  <ZAxis range={[18, 18]} />
                  <Tooltip {...tooltipProps} formatter={fmtNum(2)} />
                  <Legend {...legendProps} />
                  <Scatter name="Clase 0" data={scatter.c0} fill={C.muted} fillOpacity={0.6} isAnimationActive={false} />
                  <Scatter name="Clase 1" data={scatter.c1} fill={C.fl} fillOpacity={0.7} isAnimationActive={false} />
                  {scatter.sgdLine.length === 2 && <Scatter name="Frontera SGD" data={scatter.sgdLine} line={{ stroke: C.c1, strokeWidth: 2 }} shape={() => <g />} legendType="line" fill={C.c1} isAnimationActive={false} />}
                  {scatter.dpLine.length === 2 && <Scatter name="Frontera DP-SGD" data={scatter.dpLine} line={{ stroke: C.dp, strokeWidth: 2, strokeDasharray: '6 4' }} shape={() => <g />} legendType="line" fill={C.dp} isAnimationActive={false} />}
                </ScatterChart>
              </ChartFrame>
            </VisualCard>
          </>
        ) : (
          <VisualCard title="DP-SGD">
            <p className="text-sm text-muted-foreground">Configura los parámetros y pulsa «Entrenar SGD y DP-SGD».</p>
          </VisualCard>
        )
      }
      observations={
        res && acc ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Precisión SGD" value={f(last(res.sgd).testAcc * 100, 1) + ' %'} />
              <StatTile label="Precisión DP-SGD" value={f(last(res.dp).testAcc * 100, 1) + ' %'} tone="dp" />
              <StatTile label="Pérdida SGD" value={f(last(res.sgd).testLoss)} />
              <StatTile label="Pérdida DP-SGD" value={f(last(res.dp).testLoss)} tone="dp" />
              <StatTile label="Gradientes recortados" value={f(res.dp.clippedFraction * 100, 1) + ' %'} className="col-span-2" sub="fracción de todos los gradientes por ejemplo en DP-SGD" />
            </div>
            <PrivacyModelCard spec={dpsgdSpec(adjOf(res.params))} accounting={acc} compact />
            <ClipCheck res={res} />
            <Callout kind="info" title="Qué observar">
              Más ruido (σ) o un recorte muy agresivo (C pequeño) suelen reducir la precisión o ralentizar la convergencia. El recorte también introduce sesgo: los ejemplos con gradientes grandes pierden influencia.
            </Callout>
            <Callout kind="warn">El ε protege a cada <strong>registro</strong> de entrenamiento frente a quien vea el modelo (y sus intermedios). No dice nada sobre otras fugas (p. ej. hiperparámetros elegidos con datos privados).</Callout>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Aún no hay resultados.</p>
        )
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => setP(fromLabeled(r.params, LABELS, DEFAULTS))} onReset={reset} />}
      details={
        res &&
        trace && (
          <ShowCalculations
            equations={[
              'gᵢ = ∇θ ℓ(θ; xᵢ, yᵢ) = (σ(θᵀx̃ᵢ) − yᵢ) · x̃ᵢ,  x̃ᵢ = [xᵢ, 1]',
              'ḡᵢ = gᵢ · min(1, C / ‖gᵢ‖₂)',
              'g̃ = (Σᵢ ḡᵢ + N(0, σ²C²I)) / B',
              'θ ← θ − η · g̃',
              'Sensibilidad por paso: Δ₂ = k·C (k = 1 añadir/eliminar, k = 2 reemplazar); z = σ/k',
              'Contador RDP: ε = min_α [ T_c·α/(2z²) + ln(1/δ)/(α − 1) ],  T_c = T (lote completo) o ⌈T/⌊n/B⌋⌉ (reemplazo con mini-lotes)',
            ]}
            inputs={[
              { label: 'C', value: f(res.params.clipNorm, 4) },
              { label: 'σ', value: f(res.params.noiseMultiplier, 4) },
              { label: 'B', value: res.params.batchSize },
              { label: 'η', value: f(res.params.learningRate, 4) },
              { label: 'T (pasos)', value: res.params.steps },
              { label: 'n entrenamiento', value: res.train.length },
              { label: 'Vecindad', value: adjOf(res.params) === 'replace' ? 'reemplazar (k = 2)' : 'añadir/eliminar (k = 1)' },
            ]}
            intermediates={[
              { label: `θ antes del paso ${trace.step}`, value: trace.paramsBefore.map((v) => f(v, 4)).join(', ') },
              ...trace.perExample.slice(0, 4).map((pe) => ({ label: `‖g‖ ejemplo #${pe.index}`, value: `${f(pe.norm, 4)} → ${f(pe.clippedNorm, 4)}${pe.wasClipped ? ' (recortado)' : ''}` })),
              { label: 'Σ ḡᵢ', value: trace.gradSum.map((v) => f(v, 4)).join(', ') },
              { label: 'Ruido', value: trace.noise ? trace.noise.map((v) => f(v, 4)).join(', ') : '—' },
              { label: 'g̃', value: trace.finalGrad.map((v) => f(v, 4)).join(', ') },
              { label: `θ después del paso ${trace.step}`, value: trace.paramsAfter.map((v) => f(v, 4)).join(', ') },
            ]}
            outputs={[
              { label: 'θ final SGD', value: res.sgd.params.map((v) => f(v, 3)).join(', ') },
              { label: 'θ final DP-SGD', value: res.dp.params.map((v) => f(v, 3)).join(', ') },
              { label: 'Evaluaciones de gradiente', value: res.dp.gradEvals },
              { label: 'Composiciones contabilizadas', value: acc?.status === 'computed' ? acc.details.compositions : '—' },
              { label: 'ε', value: acc?.status === 'computed' ? f(acc.epsilon, 4) : 'No calculado' },
            ]}
            assumptions={[
              'Unidad de privacidad: un registro (record-level DP).',
              'Añadir/eliminar: la suma de gradientes recortados tiene sensibilidad L2 = C; reemplazar: 2C.',
              'Los lotes se forman barajando por época (calendario independiente de los datos). Los contadores con amplificación asumen muestreo de Poisson y no se implementan.',
              'Añadir/eliminar con B < n: el calendario depende de n, que cambia entre vecinos ⇒ No calculado.',
              'Reemplazar (n público): cada registro participa como mucho una vez por época ⇒ ⌈T/⌊n/B⌋⌉ composiciones gaussianas con Δ₂ = 2C (cota sin amplificación).',
              'Con B = n cada paso es un mecanismo gaussiano sobre todos los datos; la composición se acota con RDP.',
              'Las métricas de entrenamiento mostradas no están cubiertas por la garantía.',
              'La garantía formal requiere aleatoriedad segura; aquí se usa un PRNG con semilla.',
            ]}
          />
        )
      }
      prosCons={{
        benefits: [
          'Limita la influencia de cada ejemplo en el modelo mediante recorte y ruido calibrado.',
          'Con un contador válido, ofrece una garantía (ε, δ) sobre el modelo publicado y todos sus intermedios.',
          'Es aplicable a cualquier modelo entrenado con gradientes.',
        ],
        limitations: [
          'Reduce la precisión, especialmente con pocos datos, σ alto o C mal elegido.',
          'El recorte introduce sesgo y puede perjudicar a grupos minoritarios con gradientes grandes.',
          'Calcular gradientes por ejemplo es más costoso que el SGD estándar.',
          'Sin un contador de privacidad válido no se puede afirmar ningún ε.',
        ],
      }}
      reflection={{
        question: 'Pulsa «Usar lote completo» y entrena con σ = 0,5, 1 y 4. ¿Cómo cambian el ε calculado y la precisión? Después cambia la vecindad a «Reemplazar» con mini-lotes: ¿por qué ahora sí aparece un ε y por qué con añadir/eliminar no?',
        hint: 'Con más ruido ε disminuye (más privacidad) pero el gradiente es menos fiable. Con reemplazo n es público y el calendario de lotes no depende de los datos: cada registro participa como mucho una vez por época, con sensibilidad 2C. Con añadir/eliminar el calendario cambia con n y la cota ajustada requeriría amplificación por submuestreo (muestreo de Poisson), no implementada.',
      }}
    />
  );
}
