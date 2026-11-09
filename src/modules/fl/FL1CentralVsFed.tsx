import { useCallback, useEffect, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Play, Database, Server } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { DEFAULT_DATA_CONFIG, generateFederatedData, validateDataConfig, type FederatedDataConfig } from '@/lib/fl/data';
import { runCentralized, runFedAvg, validateFedConfig, type CentralResult, type FedAvgResult } from '@/lib/fl/fedavg';
import { BYTES_PER_PARAM, formatBytes } from '@/lib/fl/communication';
import { f, fromLabelled, pct, toLabelled, useStepper, StepControls, clientColor } from './shared';

const ID = 'fl1';
const TITLE = 'Aprendizaje centralizado frente a federado';

interface Params {
  samplesPerClient: number;
  rounds: number;
  localEpochs: number;
  localLr: number;
  seed: number;
}
const DEFAULTS: Params = { samplesPerClient: 120, rounds: 10, localEpochs: 2, localLr: 0.3, seed: 42 };
const LABELS: Record<keyof Params, string> = {
  samplesPerClient: 'Muestras por hospital',
  rounds: 'Rondas federadas',
  localEpochs: 'Épocas locales',
  localLr: 'Tasa de aprendizaje',
  seed: 'Semilla',
};

interface Result {
  params: Params;
  hospitals: { name: string; nTrain: number; positiveRate: number }[];
  central: CentralResult;
  fed: FedAvgResult;
}

function dataConfig(p: Params): FederatedDataConfig {
  return { ...DEFAULT_DATA_CONFIG, numClients: 3, samplesPerClient: p.samplesPerClient, mode: 'iid', seed: p.seed };
}
function fedConfig(p: Params) {
  return { rounds: p.rounds, localEpochs: p.localEpochs, localLr: p.localLr, batchSize: 16, participation: 1, seed: p.seed, dp: null };
}
function compute(p: Params): Result {
  const data = generateFederatedData(dataConfig(p));
  const central = runCentralized(data, p.rounds * p.localEpochs, p.localLr, 16, p.seed);
  const fed = runFedAvg(data, fedConfig(p));
  return { params: p, hospitals: data.clients.map((c) => ({ name: c.name, nTrain: c.train.length, positiveRate: c.positiveRate })), central, fed };
}

// ---------- Diagrama animado ----------
const SERVER = { x: 160, y: 38 };
const HOSP = [
  { x: 55, y: 182 },
  { x: 160, y: 182 },
  { x: 265, y: 182 },
];

const CENTRAL_STEPS = [
  'Cada hospital guarda sus registros de pacientes localmente.',
  'Los DATOS BRUTOS de cada hospital se copian y envían al servidor central.',
  'El servidor entrena un único modelo global con todos los datos agrupados.',
];
const FED_STEPS = [
  'Paso 1 — El servidor distribuye los parámetros del modelo global a cada hospital.',
  'Paso 2 — Cada hospital entrena localmente con sus propios datos (que no salen del hospital).',
  'Paso 3 — Cada hospital calcula su actualización del modelo (Δ = w_local − w_global).',
  'Paso 4 — Las actualizaciones (no los datos) se envían al servidor de agregación.',
  'Paso 5 — El servidor agrega las actualizaciones: w = Σ (n_k / N) · w_k.',
  'Paso 6 — El nuevo modelo global se redistribuye a los hospitales para la siguiente ronda.',
];

function Glyph({ kind, color }: { kind: 'data' | 'params' | 'update'; color: string }) {
  if (kind === 'data')
    return (
      <g>
        {[0, 5, 10].map((dy) => (
          <rect key={dy} x={-9} y={-9 + dy} width={18} height={3.6} rx={1} fill={color} />
        ))}
      </g>
    );
  if (kind === 'update') return <path d="M0,-8 L8,0 L0,8 L-8,0 Z" fill={color} stroke="hsl(var(--card))" strokeWidth={1} />;
  return <circle r={7} fill={color} stroke="hsl(var(--card))" strokeWidth={1} />;
}

function Mover({ from, to, kind, color, reduce, delay = 0, id }: { from: { x: number; y: number }; to: { x: number; y: number }; kind: 'data' | 'params' | 'update'; color: string; reduce: boolean; delay?: number; id: string }) {
  return (
    <motion.g key={id} initial={{ x: reduce ? to.x : from.x, y: reduce ? to.y : from.y, opacity: reduce ? 1 : 0.4 }} animate={{ x: to.x, y: to.y, opacity: 1 }} transition={{ duration: reduce ? 0 : 1.1, delay: reduce ? 0 : delay, ease: 'easeInOut' }}>
      <Glyph kind={kind} color={color} />
    </motion.g>
  );
}

function Node({ x, y, label, sub, active, kind }: { x: number; y: number; label: string; sub?: string; active?: boolean; kind: 'server' | 'hospital' }) {
  const w = kind === 'server' ? 110 : 88;
  return (
    <g>
      <rect x={x - w / 2} y={y - 16} width={w} height={32} rx={6} fill="hsl(var(--card))" stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--border))'} strokeWidth={active ? 2 : 1} />
      <text x={x} y={y - 2} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="hsl(var(--foreground))">
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 10} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))">
          {sub}
        </text>
      )}
    </g>
  );
}

function FlowDiagram({ mode, step, hospitals, round }: { mode: 'central' | 'fed'; step: number; hospitals: Result['hospitals']; round: number }) {
  const reduce = !!useReducedMotion();
  const dataColor = C.warn;
  const paramColor = C.fl;
  const updColor = C.dp;
  const above = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - 30 });
  const nearServer = (k: number) => ({ x: SERVER.x - 30 + k * 30, y: SERVER.y + 30 });
  const serverActive = mode === 'central' ? step === 2 : step === 4;
  const hospActive = mode === 'fed' && (step === 1 || step === 2);
  const desc = mode === 'central' ? CENTRAL_STEPS[step] : FED_STEPS[step];
  return (
    <svg viewBox="0 0 320 215" className="h-auto w-full" role="img" aria-label={`${mode === 'central' ? 'Flujo centralizado' : 'Flujo federado'}. ${desc}`}>
      {HOSP.map((h, k) => (
        <line key={k} x1={SERVER.x} y1={SERVER.y + 16} x2={h.x} y2={h.y - 16} stroke="hsl(var(--border))" strokeDasharray="3 3" />
      ))}
      <Node kind="server" x={SERVER.x} y={SERVER.y} label={mode === 'central' ? 'Servidor central' : 'Servidor de agregación'} sub={mode === 'central' ? (step === 2 ? 'entrenando modelo…' : '') : step === 4 ? 'Σ (n_k/N)·w_k' : `ronda ${round}`} active={serverActive} />
      {hospitals.map((h, k) => (
        <Node key={k} kind="hospital" x={HOSP[k].x} y={HOSP[k].y} label={h.name} sub={`n = ${h.nTrain}`} active={hospActive} />
      ))}
      {/* Datos brutos */}
      {hospitals.map((_, k) => {
        if (mode === 'central') {
          if (step === 0) return <Mover key={`d${k}-0`} id={`d${k}-0`} from={above(HOSP[k])} to={above(HOSP[k])} kind="data" color={dataColor} reduce />;
          return <Mover key={`d${k}-m`} id={`d${k}-m`} from={above(HOSP[k])} to={nearServer(k)} kind="data" color={dataColor} reduce={reduce || step > 1} delay={k * 0.15} />;
        }
        // En FL los datos SIEMPRE quedan en el hospital
        return <Mover key={`d${k}`} id={`d${k}`} from={{ x: HOSP[k].x - 30, y: HOSP[k].y + 8 }} to={{ x: HOSP[k].x - 30, y: HOSP[k].y + 8 }} kind="data" color={dataColor} reduce />;
      })}
      {mode === 'central' && step === 2 && (
        <motion.circle cx={SERVER.x + 70} cy={SERVER.y} r={8} fill={paramColor} initial={{ scale: reduce ? 1 : 0 }} animate={{ scale: 1 }} transition={{ duration: reduce ? 0 : 0.5 }} />
      )}
      {mode === 'fed' &&
        hospitals.map((_, k) => {
          const hp = above(HOSP[k]);
          switch (step) {
            case 0:
              return <Mover key={`p${k}-0`} id={`p${k}-0`} from={SERVER} to={hp} kind="params" color={paramColor} reduce={reduce} delay={k * 0.15} />;
            case 1:
              return (
                <motion.g key={`p${k}-1`} initial={{ x: hp.x, y: hp.y }} animate={reduce ? { x: hp.x, y: hp.y } : { x: hp.x, y: hp.y, scale: [1, 1.35, 1] }} transition={{ duration: 1, repeat: reduce ? 0 : 1 }}>
                  <Glyph kind="params" color={paramColor} />
                </motion.g>
              );
            case 2:
              return <Mover key={`u${k}-2`} id={`u${k}-2`} from={hp} to={hp} kind="update" color={updColor} reduce />;
            case 3:
              return <Mover key={`u${k}-3`} id={`u${k}-3`} from={hp} to={nearServer(k)} kind="update" color={updColor} reduce={reduce} delay={k * 0.15} />;
            case 4:
              return <Mover key={`u${k}-4`} id={`u${k}-4`} from={nearServer(k)} to={{ x: SERVER.x, y: SERVER.y + 30 }} kind="update" color={updColor} reduce={reduce} />;
            default:
              return <Mover key={`p${k}-5`} id={`p${k}-5`} from={SERVER} to={hp} kind="params" color={paramColor} reduce={reduce} delay={k * 0.15} />;
          }
        })}
    </svg>
  );
}

function FlowLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <svg width="18" height="14" aria-hidden viewBox="-9 -9 18 18">
          <Glyph kind="data" color={C.warn} />
        </svg>
        Datos brutos (registros)
      </span>
      <span className="flex items-center gap-1">
        <svg width="16" height="16" aria-hidden viewBox="-8 -8 16 16">
          <Glyph kind="params" color={C.fl} />
        </svg>
        Parámetros del modelo global
      </span>
      <span className="flex items-center gap-1">
        <svg width="16" height="16" aria-hidden viewBox="-8 -8 16 16">
          <Glyph kind="update" color={C.dp} />
        </svg>
        Actualización local (Δ o w_k)
      </span>
    </div>
  );
}

export default function FL1CentralVsFed() {
  const [params, setParams, resetParams] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [result, setResult] = usePersistentState<Result | null>(`${ID}.result`, null, false);
  const { addRun } = useRuns(ID);
  const central = useStepper(CENTRAL_STEPS.length, 1800);
  const fed = useStepper(FED_STEPS.length, 1800);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const errors = useMemo(() => [...validateDataConfig(dataConfig(params)), ...validateFedConfig(fedConfig(params))], [params]);

  const execute = useCallback(
    (record: boolean, p: Params = params) => {
      if ([...validateDataConfig(dataConfig(p)), ...validateFedConfig(fedConfig(p))].length) return;
      const r = compute(p);
      setResult(r);
      if (!record) return;
      const last = r.fed.rounds[r.fed.rounds.length - 1];
      addRun({
        experimentTitle: TITLE,
        seed: p.seed,
        params: toLabelled(p, LABELS),
        results: {
          'Precisión centralizada': r.central.history[r.central.history.length - 1].testAcc,
          'Precisión federada (FedAvg)': last.metrics.testAcc,
          'Bytes de datos brutos enviados (centralizado)': r.central.rawDataBytes,
          'Bytes de parámetros intercambiados (FL)': r.fed.totalBytes,
        },
        assumptions: ['Tres hospitales con datos sintéticos IID.', 'Regresión logística de 3 parámetros; float32 (4 bytes por valor).', `Centralizado entrena ${p.rounds * p.localEpochs} épocas (= rondas × épocas locales) para comparar con FL.`],
        limitations: ['Los bytes cuentan solo carga útil; no hay red real.', 'Que los datos no salgan del hospital no implica que las actualizaciones no filtren información.'],
        privacyGuarantee: null,
      });
    },
    [params, setResult, addRun],
  );

  useEffect(() => {
    if (!result && !errors.length) execute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hospitals = result?.hospitals ?? [];
  const lastFed = result?.fed.rounds[result.fed.rounds.length - 1];
  const centralAcc = result ? result.central.history[result.central.history.length - 1].testAcc : null;
  const chartData = useMemo(() => {
    if (!result) return [];
    const E = result.params.localEpochs;
    return Array.from({ length: result.params.rounds + 1 }, (_, r) => ({
      ronda: r,
      centralizado: result.central.history[r * E].testAcc,
      federado: r === 0 ? result.fed.initMetrics.testAcc : result.fed.rounds[r - 1].metrics.testAcc,
    }));
  }, [result]);
  const rawPerHospital = (n: number) => n * 3 * BYTES_PER_PARAM;
  const updPerHospital = result ? result.params.rounds * 3 * BYTES_PER_PARAM : 0;

  return (
    <ExperimentLayout
      experimentId={ID}
      module="fl"
      kicker="Experimento 1"
      title={TITLE}
      objective="Distinguir qué información se desplaza en el aprendizaje centralizado (datos brutos) y en el federado (parámetros y actualizaciones), y por qué mantener los datos en local no garantiza por sí solo la confidencialidad."
      badges={['sim', 'real', 'concept']}
      intro={
        <>
          <p>
            Tres hospitales ficticios —{hospitals.map((h) => h.name).join(', ') || 'Hospital Norte, Hospital Sur y Clínica Central'}— quieren entrenar juntos un modelo que prediga si un paciente tiene <em>riesgo alto</em> a partir de dos biomarcadores. Ningún hospital tiene
            datos suficientes por sí solo, pero compartir historiales clínicos es delicado.
          </p>
          <p>
            <strong>Opción A (centralizada):</strong> cada hospital envía una copia de sus registros a un servidor, que entrena el modelo. <strong>Opción B (federada):</strong> el servidor envía el modelo a cada hospital, cada uno entrena localmente y solo devuelve una{' '}
            <em>actualización del modelo</em>; el servidor las combina con <Term k="fedavg">FedAvg</Term>. Repite esto durante varias <Term k="round">rondas de comunicación</Term>.
          </p>
          <p>
            Observa qué viaja por la red en cada caso. Las animaciones son <strong>ilustraciones conceptuales</strong>; los recuentos de muestras, bytes y precisiones se calculan realmente en tu navegador.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="Datos">
            <ParamSlider label="Muestras por hospital" ariaLabel="Muestras por hospital" value={params.samplesPerClient} onChange={(v) => set('samplesPerClient', Math.round(v))} min={20} max={1000} step={10} help="Se reserva un 25 % como test local de cada hospital." />
          </ConfigSection>
          <ConfigSection title="Entrenamiento">
            <ParamSlider label={<Term k="round">Rondas federadas</Term>} ariaLabel="Rondas federadas" value={params.rounds} onChange={(v) => set('rounds', Math.round(v))} min={1} max={50} step={1} />
            <ParamSlider label={<Term k="localEpochs">Épocas locales</Term>} ariaLabel="Épocas locales" value={params.localEpochs} onChange={(v) => set('localEpochs', Math.round(v))} min={1} max={10} step={1} />
            <ParamSlider label={<Term k="learningRate">Tasa de aprendizaje</Term>} ariaLabel="Tasa de aprendizaje" value={params.localLr} onChange={(v) => set('localLr', v)} min={0.01} max={2} step={0.01} />
            <SeedControl value={params.seed} onChange={(v) => set('seed', v)} />
          </ConfigSection>
          <ErrorList errors={errors} />
          <Button className="w-full" variant="fl" disabled={errors.length > 0} onClick={() => execute(true)}>
            <Play /> Ejecutar ambos enfoques
          </Button>
        </>
      }
      visual={
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <VisualCard title={<span className="flex items-center gap-2"><Database className="h-4 w-4 text-warn" aria-hidden /> Centralizado</span>} actions={<StepControls stepper={central} count={CENTRAL_STEPS.length} label="flujo centralizado" />}>
              <FlowDiagram mode="central" step={central.step} hospitals={hospitals} round={1} />
              <p className="mt-2 min-h-[2.5rem] text-[13px] leading-snug" aria-live="polite">
                {CENTRAL_STEPS[central.step]}
              </p>
            </VisualCard>
            <VisualCard title={<span className="flex items-center gap-2"><Server className="h-4 w-4 text-fl" aria-hidden /> Federado</span>} actions={<StepControls stepper={fed} count={FED_STEPS.length} label="flujo federado" />}>
              <FlowDiagram mode="fed" step={fed.step} hospitals={hospitals} round={1} />
              <p className="mt-2 min-h-[2.5rem] text-[13px] leading-snug" aria-live="polite">
                {FED_STEPS[fed.step]}
              </p>
            </VisualCard>
          </div>
          <FlowLegend />
          {result && (
            <VisualCard title="¿Qué sale de cada hospital?" description="Cálculo real a partir de los datos sintéticos generados (float32 = 4 bytes por valor).">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th scope="col" className="py-1 text-left font-medium">Hospital</th>
                      <th scope="col" className="py-1 text-right font-medium">Registros de entrenamiento</th>
                      <th scope="col" className="py-1 text-right font-medium">% riesgo alto</th>
                      <th scope="col" className="py-1 text-right font-medium">Centralizado: datos brutos enviados</th>
                      <th scope="col" className="py-1 text-right font-medium">FL: actualizaciones enviadas ({result.params.rounds} rondas)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hospitals.map((h, k) => (
                      <tr key={h.name} className="border-b last:border-0">
                        <th scope="row" className="py-1 text-left font-medium" style={{ color: clientColor(k) }}>
                          {h.name}
                        </th>
                        <td className="num py-1 text-right">{h.nTrain}</td>
                        <td className="num py-1 text-right">{pct(h.positiveRate)}</td>
                        <td className="num py-1 text-right">
                          {formatBytes(rawPerHospital(h.nTrain))} <span className="text-muted-foreground">({h.nTrain} × 3 valores)</span>
                        </td>
                        <td className="num py-1 text-right">
                          {formatBytes(updPerHospital)} <span className="text-muted-foreground">({result.params.rounds} × 3 parámetros)</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                En FL los <em>datos brutos</em> nunca salen del hospital, pero sí salen {result.params.rounds} actualizaciones que se calcularon a partir de esos datos. Con un modelo de 3 parámetros esto es muy poco; con modelos de millones de parámetros, las actualizaciones pueden pesar más que los propios datos (ver Experimento 4).
              </p>
            </VisualCard>
          )}
          {result && (
            <VisualCard title="Precisión en el conjunto de evaluación global">
              <ChartFrame
                title="Precisión de test por ronda"
                description="Comparación de la precisión del modelo centralizado (tras el mismo número de épocas) y del modelo federado en el conjunto de evaluación fijo."
                data={chartData}
                columns={[
                  { key: 'ronda', label: 'Ronda' },
                  { key: 'centralizado', label: 'Centralizado', format: (v) => pct(v as number) },
                  { key: 'federado', label: 'Federado', format: (v) => pct(v as number) },
                ]}
              >
                <LineChart data={chartData} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="ronda" {...axisProps} label={{ value: 'Ronda (centralizado: épocas / E)', position: 'insideBottom', offset: -2, fontSize: 11, fill: C.axis }} height={36} />
                  <YAxis {...axisProps} domain={[0.3, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <RTooltip {...tooltipProps} formatter={(v) => pct(v as number)} labelFormatter={(l) => `Ronda ${l}`} />
                  <Legend {...legendProps} />
                  <Line type="monotone" dataKey="centralizado" name="Centralizado" stroke={C.warn} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="federado" name="Federado (FedAvg)" stroke={C.fl} strokeWidth={2} dot={false} />
                </LineChart>
              </ChartFrame>
            </VisualCard>
          )}
        </>
      }
      observations={
        result && lastFed ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Precisión centralizada" value={pct(centralAcc)} tone="warn" />
              <StatTile label="Precisión federada" value={pct(lastFed.metrics.testAcc)} tone="fl" />
              <StatTile label="Datos brutos al servidor" value={formatBytes(result.central.rawDataBytes)} sub="centralizado" />
              <StatTile label="Parámetros intercambiados" value={formatBytes(result.fed.totalBytes)} sub="FL, subida + bajada" />
            </div>
            <p className="text-[13px] leading-relaxed">
              Diferencia de precisión: <span className="num font-semibold">{f(((centralAcc ?? 0) - lastFed.metrics.testAcc) * 100, 2)} puntos</span> (centralizado − federado). Con datos IID y un modelo convexo como este, FedAvg suele acercarse al resultado centralizado; no es
              una regla general.
            </p>
            <Callout kind="warn" title="Los datos quedan en local, pero…">
              Las actualizaciones se calculan <em>a partir</em> de los datos de cada hospital. Un servidor curioso puede inferir información de ellas (Experimento 5). El Aprendizaje Federado por sí solo <strong>no garantiza la confidencialidad</strong>: necesita defensas
              adicionales como <Term k="secureAggregation">agregación segura</Term> o privacidad diferencial.
            </Callout>
            <Callout kind="info">El modelo global final también puede memorizar información de los datos de entrenamiento, tanto en el enfoque centralizado como en el federado.</Callout>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pulsa «Ejecutar» para calcular los resultados.</p>
        )
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => { const p = fromLabelled(r.params, LABELS, DEFAULTS); setParams(p); execute(false, p); }} onReset={resetParams} />}
      details={
        result && lastFed ? (
          <ShowCalculations
            equations={[
              'Bytes de datos brutos (hospital k) = n_k × (d + 1) × 4   con d = 2 características + 1 etiqueta',
              'Bytes FL por ronda = m × P × 4 (bajada) + m × P × 4 (subida)   con P = 3 parámetros y m clientes',
              'FedAvg: w_global = Σ_k (n_k / N) · w_k',
            ]}
            inputs={[
              { label: 'Hospitales', value: 3 },
              { label: 'n_k (entrenamiento)', value: hospitals.map((h) => h.nTrain).join(', ') },
              { label: 'Rondas × épocas locales', value: `${result.params.rounds} × ${result.params.localEpochs}` },
              { label: 'Tamaño de lote', value: 16 },
            ]}
            intermediates={[
              { label: 'Total de registros agrupados', value: hospitals.reduce((s, h) => s + h.nTrain, 0) },
              { label: 'Evaluaciones de gradiente (centralizado)', value: result.central.gradEvals.toLocaleString('es-ES') },
              { label: 'Evaluaciones de gradiente (FL)', value: result.fed.totalGradEvals.toLocaleString('es-ES') },
            ]}
            outputs={[
              { label: 'Parámetros finales (centralizado)', value: `[${result.central.params.map((v) => f(v, 3)).join(', ')}]` },
              { label: 'Parámetros finales (FL)', value: `[${result.fed.finalParams.map((v) => f(v, 3)).join(', ')}]` },
              { label: 'Bytes datos brutos', value: result.central.rawDataBytes },
              { label: 'Bytes FL totales', value: result.fed.totalBytes },
            ]}
            assumptions={['Datos sintéticos IID: los tres hospitales siguen la misma distribución.', 'Participación del 100 % en cada ronda.', 'Coste de comunicación simplificado: solo carga útil float32.', 'El servidor central (opción A) y el agregador (opción B) son entidades que podrían ser curiosas.']}
          />
        ) : null
      }
      prosCons={{
        benefits: ['Los registros brutos no abandonan la institución que los custodia.', 'Reduce la superficie de una gran base de datos centralizada.', 'Permite colaborar sin transferir la propiedad de los datos.'],
        limitations: [
          'Las actualizaciones del modelo pueden revelar información sobre los datos locales.',
          'Requiere muchas rondas de comunicación y coordinación entre participantes.',
          'El modelo final puede memorizar datos igual que en el enfoque centralizado.',
          'Con datos heterogéneos la precisión puede diferir de la centralizada.',
        ],
      }}
      reflection={{
        question: 'Si un hospital pudiera elegir entre enviar sus datos a un servidor de confianza o participar en FL con un servidor que no es de confianza, ¿qué información quedaría expuesta en cada caso?',
        hint: 'Piensa en quién ve los datos brutos, quién ve las actualizaciones y qué se puede aprender del modelo final en ambos casos.',
      }}
    />
  );
}
