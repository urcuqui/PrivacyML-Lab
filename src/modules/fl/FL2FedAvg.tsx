import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Play } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamChoice, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, Formula, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { DEFAULT_DATA_CONFIG, FEATURE_NAMES, generateFederatedData, validateDataConfig, type DistributionMode, type FederatedData, type FederatedDataConfig } from '@/lib/fl/data';
import { numSelected, runFedAvg, validateFedConfig, type FedAvgConfig, type FedAvgResult, type RoundTrace } from '@/lib/fl/fedavg';
import { formatBytes } from '@/lib/fl/communication';
import { cn } from '@/lib/utils';
import { ClientScatter, ParamVec, PARAM_NAMES, ScatterLegend, StepControls, clientColor, f, fromLabelled, pct, toLabelled, useStepper, type BoundaryLine } from './shared';

const ID = 'fl2';
const TITLE = 'Construye una ronda de Aprendizaje Federado';

interface Params {
  numClients: number;
  samplesPerClient: number;
  rounds: number;
  localEpochs: number;
  localLr: number;
  batchSize: number;
  participationPct: number;
  mode: DistributionMode;
  sizeSkew: number;
  seed: number;
}
const DEFAULTS: Params = { sizeSkew: 0.5, numClients: 4, samplesPerClient: 100, rounds: 8, localEpochs: 2, localLr: 0.3, batchSize: 16, participationPct: 75, mode: 'iid', seed: 7 };
const LABELS: Record<keyof Params, string> = {
  numClients: 'Clientes',
  samplesPerClient: 'Muestras por cliente',
  rounds: 'Rondas',
  localEpochs: 'Épocas locales',
  localLr: 'Tasa de aprendizaje local',
  batchSize: 'Tamaño de lote',
  participationPct: 'Participación (%)',
  mode: 'Distribución',
  sizeSkew: 'Asimetría de tamaños',
  seed: 'Semilla',
};

const STEPS = ['Inicialización del modelo global', 'Selección de clientes', 'Entrenamiento local', 'Transmisión de actualizaciones', 'Agregación federada', 'Actualización del modelo global'];

const dataCfg = (p: Params): FederatedDataConfig => ({ ...DEFAULT_DATA_CONFIG, numClients: p.numClients, samplesPerClient: p.samplesPerClient, mode: p.mode, sizeSkew: p.sizeSkew, seed: p.seed });
const fedCfg = (p: Params): FedAvgConfig => ({ rounds: p.rounds, localEpochs: p.localEpochs, localLr: p.localLr, batchSize: p.batchSize, participation: p.participationPct / 100, seed: p.seed, dp: null });

interface Result {
  params: Params;
  data: FederatedData;
  fed: FedAvgResult;
}

function TransmissionDiagram({ rt, data, step }: { rt: RoundTrace; data: FederatedData; step: number }) {
  const reduce = !!useReducedMotion();
  const K = data.clients.length;
  const W = 340;
  const xs = (k: number) => 20 + ((W - 40) * (k + 0.5)) / K;
  const server = { x: W / 2, y: 30 };
  const yC = 150;
  return (
    <svg viewBox={`0 0 ${W} 185`} className="h-auto w-full" role="img" aria-label={`Ronda ${rt.round}: ${rt.selected.length} de ${K} clientes envían su modelo local al servidor.`}>
      {data.clients.map((c, k) => {
        const sel = rt.selected.includes(k);
        return (
          <g key={k} opacity={sel ? 1 : 0.35}>
            <line x1={server.x} y1={server.y + 14} x2={xs(k)} y2={yC - 12} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <rect x={xs(k) - 14} y={yC - 12} width={28} height={24} rx={4} fill="hsl(var(--card))" stroke={sel ? clientColor(k) : 'hsl(var(--border))'} strokeWidth={sel ? 2 : 1} />
            <text x={xs(k)} y={yC + 4} textAnchor="middle" fontSize={9} fill="hsl(var(--foreground))">
              C{k + 1}
            </text>
            <text x={xs(k)} y={yC + 24} textAnchor="middle" fontSize={7.5} fill="hsl(var(--muted-foreground))">
              n={c.train.length}
            </text>
          </g>
        );
      })}
      <rect x={server.x - 55} y={server.y - 14} width={110} height={28} rx={5} fill="hsl(var(--card))" stroke="hsl(var(--primary))" />
      <text x={server.x} y={server.y + 4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="hsl(var(--foreground))">
        Servidor
      </text>
      {step === 3 &&
        rt.selected.map((k, i) => (
          <motion.path
            key={`${rt.round}-${k}`}
            d="M0,-6 L6,0 L0,6 L-6,0 Z"
            fill={clientColor(k)}
            initial={{ x: xs(k), y: yC - 22, opacity: reduce ? 1 : 0.3 }}
            animate={{ x: reduce ? xs(k) + (server.x - xs(k)) * 0.85 : [xs(k), xs(k) + (server.x - xs(k)) * 0.85], y: reduce ? server.y + 24 : [yC - 22, server.y + 24], opacity: 1 }}
            transition={{ duration: reduce ? 0 : 1.2, delay: reduce ? 0 : i * 0.12, ease: 'easeInOut' }}
          />
        ))}
    </svg>
  );
}

function StepView({ step, rt, data, prevRt }: { step: number; rt: RoundTrace; data: FederatedData; prevRt: { testAcc: number; testLoss: number } }) {
  const K = data.clients.length;
  switch (step) {
    case 0:
      return (
        <div className="space-y-2 text-[13px] leading-relaxed">
          <p>
            {rt.round === 1 ? (
              <>El servidor inicializa el modelo global con todos los parámetros a cero (regresión logística: <span className="num">w₁, w₂, b</span>).</>
            ) : (
              <>El modelo global al inicio de la ronda {rt.round} es el resultado de la ronda {rt.round - 1}.</>
            )}
          </p>
          <Formula>
            w<sub>global</sub><sup>({rt.round - 1})</sup> = <ParamVec v={rt.globalBefore} />
          </Formula>
          <p className="text-xs text-muted-foreground">
            Rendimiento de este modelo en el conjunto de evaluación global: precisión {pct(prevRt.testAcc)}, pérdida {f(prevRt.testLoss, 4)}.
          </p>
        </div>
      );
    case 1:
      return (
        <div className="space-y-2">
          <p className="text-[13px]">
            Se seleccionan aleatoriamente <span className="num font-semibold">m = {rt.selected.length}</span> de {K} clientes (participación configurada; selección reproducible con la semilla).
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Clientes">
            {data.clients.map((c, k) => {
              const sel = rt.selected.includes(k);
              return (
                <li key={k} className={cn('rounded-md border p-2 text-xs transition-colors', sel ? 'border-2' : 'opacity-50')} style={sel ? { borderColor: clientColor(k) } : undefined}>
                  <div className="font-semibold">{c.name}</div>
                  <div className="num text-muted-foreground">n = {c.train.length}</div>
                  <div className={sel ? 'font-medium text-ok' : 'text-muted-foreground'}>{sel ? '✓ seleccionado' : 'no participa'}</div>
                </li>
              );
            })}
          </ul>
        </div>
      );
    case 2: {
      const maxE = Math.max(...rt.updates.map((u) => u.localLosses.length));
      const lossData = Array.from({ length: maxE + 1 }, (_, e) => {
        const row: Record<string, number> = { epoca: e };
        rt.updates.forEach((u) => (row[`c${u.clientId}`] = e === 0 ? u.lossBefore : u.localLosses[e - 1]));
        return row;
      });
      return (
        <div className="space-y-3">
          <p className="text-[13px]">
            Cada cliente seleccionado parte de w<sub>global</sub> y ejecuta SGD por mini-lotes sobre sus propios datos. Solo el resultado (w<sub>k</sub>) saldrá del cliente.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <caption className="sr-only">Parámetros locales por cliente</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1 text-left font-medium">Cliente</th>
                  <th scope="col" className="py-1 text-right font-medium">w inicial</th>
                  <th scope="col" className="py-1 text-right font-medium">w<sub>k</sub> local final</th>
                  <th scope="col" className="py-1 text-right font-medium">Δ<sub>k</sub> = w<sub>k</sub> − w</th>
                  <th scope="col" className="py-1 text-right font-medium">‖Δ<sub>k</sub>‖</th>
                  <th scope="col" className="py-1 text-right font-medium">Pérdida local (antes → después)</th>
                </tr>
              </thead>
              <tbody>
                {rt.updates.map((u) => (
                  <tr key={u.clientId} className="border-b last:border-0">
                    <th scope="row" className="py-1 text-left font-medium" style={{ color: clientColor(u.clientId) }}>
                      {data.clients[u.clientId].name}
                    </th>
                    <td className="py-1 text-right"><ParamVec v={u.startParams} digits={3} /></td>
                    <td className="py-1 text-right"><ParamVec v={u.endParams} digits={3} /></td>
                    <td className="py-1 text-right"><ParamVec v={u.delta} digits={3} /></td>
                    <td className="num py-1 text-right">{f(u.deltaNorm, 3)}</td>
                    <td className="num py-1 text-right">
                      {f(u.lossBefore, 3)} → {f(u.localLosses[u.localLosses.length - 1], 3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ChartFrame
            title="Pérdida local por época"
            description="Entropía cruzada de cada cliente sobre sus propios datos de entrenamiento, antes (época 0) y después de cada época local."
            height={200}
            data={lossData}
            columns={[{ key: 'epoca', label: 'Época' }, ...rt.updates.map((u) => ({ key: `c${u.clientId}`, label: data.clients[u.clientId].name, format: (v: unknown) => f(v as number, 4) }))]}
          >
            <LineChart data={lossData} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="epoca" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v) => f(v, 2)} />
              <RTooltip {...tooltipProps} formatter={(v) => f(v as number, 4)} labelFormatter={(l) => `Época ${l}`} />
              <Legend {...legendProps} />
              {rt.updates.map((u) => (
                <Line key={u.clientId} type="monotone" dataKey={`c${u.clientId}`} name={data.clients[u.clientId].name} stroke={clientColor(u.clientId)} strokeWidth={2} dot />
              ))}
            </LineChart>
          </ChartFrame>
        </div>
      );
    }
    case 3:
      return (
        <div className="space-y-2">
          <TransmissionDiagram rt={rt} data={data} step={step} />
          <p className="text-[13px]">
            Cada cliente envía sus {rt.globalBefore.length} parámetros locales (o, equivalentemente, Δ<sub>k</sub>). Subida en esta ronda: <span className="num font-semibold">{formatBytes(rt.bytesUp)}</span>; bajada (envío del modelo global):{' '}
            <span className="num font-semibold">{formatBytes(rt.bytesDown)}</span>.
          </p>
          <Callout kind="warn">El servidor recibe cada actualización individual. Sin agregación segura, puede inspeccionarlas una a una (Experimento 5).</Callout>
        </div>
      );
    case 4:
      return (
        <div className="space-y-3">
          <Formula label="Ecuación de agregación FedAvg">
            w<sub>global</sub> = Σ<sub>k ∈ S</sub> (n<sub>k</sub> / N) · w<sub>k</sub>,   N = Σ<sub>k ∈ S</sub> n<sub>k</sub> = {rt.updates.map((u) => u.nSamples).join(' + ')} = <strong>{rt.N}</strong>
          </Formula>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-xs">
              <caption className="sr-only">Pesos de agregación</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1 text-left font-medium">Cliente</th>
                  <th scope="col" className="py-1 text-right font-medium">n<sub>k</sub></th>
                  <th scope="col" className="py-1 text-right font-medium">peso n<sub>k</sub>/N</th>
                  <th scope="col" className="py-1 text-right font-medium">w<sub>k</sub></th>
                </tr>
              </thead>
              <tbody>
                {rt.updates.map((u, i) => (
                  <tr key={u.clientId} className="border-b last:border-0">
                    <th scope="row" className="py-1 text-left font-medium" style={{ color: clientColor(u.clientId) }}>
                      {data.clients[u.clientId].name}
                    </th>
                    <td className="num py-1 text-right">{u.nSamples}</td>
                    <td className="num py-1 text-right">{f(rt.weights[i].weight, 4)}</td>
                    <td className="py-1 text-right"><ParamVec v={u.endParams} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            {PARAM_NAMES.map((name, j) => (
              <Formula key={name}>
                {name} = {rt.updates.map((u, i) => `${f(rt.weights[i].weight, 3)}×(${f(u.endParams[j], 4)})`).join(' + ')} = <strong>{f(rt.aggregated[j], 4)}</strong>
              </Formula>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Los clientes con más muestras pesan más. N incluye solo a los clientes que participan en esta ronda.</p>
        </div>
      );
    default: {
      const d = rt.globalAfter.map((v, j) => v - rt.globalBefore[j]);
      return (
        <div className="space-y-3">
          <Formula>
            w<sub>global</sub><sup>({rt.round})</sup> = <ParamVec v={rt.globalAfter} />   (cambio: <ParamVec v={d} />)
          </Formula>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Precisión test global" value={pct(rt.metrics.testAcc)} sub={`antes: ${pct(prevRt.testAcc)}`} tone="fl" />
            <StatTile label="Pérdida test global" value={f(rt.metrics.testLoss, 4)} sub={`antes: ${f(prevRt.testLoss, 4)}`} />
            <StatTile label="Pérdida de entrenamiento" value={f(rt.metrics.trainLoss, 4)} sub="ponderada por n_k" />
            <StatTile label="Clientes" value={`${rt.selected.length}/${K}`} sub="participaron" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="mb-1 text-left text-xs text-muted-foreground">Precisión del nuevo modelo global en el test local de cada cliente</caption>
              <tbody>
                {data.clients.map((c, k) => (
                  <tr key={k} className="border-b last:border-0">
                    <th scope="row" className="py-1 text-left font-normal" style={{ color: clientColor(k) }}>
                      {c.name}
                      {!rt.selected.includes(k) && <span className="text-muted-foreground"> (no participó)</span>}
                    </th>
                    <td className="num py-1 text-right">{pct(rt.metrics.perClientAcc[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">El modelo actualizado se redistribuye a los clientes seleccionados en la siguiente ronda.</p>
        </div>
      );
    }
  }
}

export default function FL2FedAvg() {
  const [params, setParams, resetParams] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [result, setResult] = usePersistentState<Result | null>(`${ID}.result`, null, false);
  const [roundIdx, setRoundIdx] = usePersistentState<number>(`${ID}.round`, 1, false);
  const [view, setView] = useState<'test' | number>('test');
  const stepper = useStepper(STEPS.length, 2200);
  const { addRun } = useRuns(ID);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const errors = useMemo(() => [...validateDataConfig(dataCfg(params)), ...validateFedConfig(fedCfg(params))], [params]);

  const execute = useCallback(
    (record: boolean, p: Params = params) => {
      if ([...validateDataConfig(dataCfg(p)), ...validateFedConfig(fedCfg(p))].length) return;
      const data = generateFederatedData(dataCfg(p));
      const fed = runFedAvg(data, fedCfg(p));
      setResult({ params: p, data, fed });
      setRoundIdx(1);
      stepper.setStep(0);
      setView('test');
      if (!record) return;
      const last = fed.rounds[fed.rounds.length - 1];
      addRun({
        experimentTitle: TITLE,
        seed: p.seed,
        params: toLabelled(p, LABELS),
        results: {
          'Precisión test global final': last.metrics.testAcc,
          'Pérdida test global final': last.metrics.testLoss,
          'Clientes por ronda (m)': last.selected.length,
          'w₁ final': fed.finalParams[0],
          'w₂ final': fed.finalParams[1],
          'b final': fed.finalParams[2],
          'Bytes totales': fed.totalBytes,
        },
        assumptions: ['FedAvg ponderado por n_k de los clientes participantes.', 'Selección uniforme sin reemplazo de round(p·K) clientes por ronda.', 'Evaluación en un conjunto global fijo (mezcla de las distribuciones de los clientes).'],
        limitations: ['Modelo lineal de 3 parámetros y datos sintéticos.', 'Sin fallos de clientes, latencia ni clientes maliciosos.', 'Sin garantías de privacidad: las actualizaciones individuales son visibles para el servidor.'],
        privacyGuarantee: null,
      });
    },
    [params, setResult, setRoundIdx, stepper, addRun],
  );

  useEffect(() => {
    if (!result && !errors.length) execute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const R = result?.fed.rounds.length ?? 0;
  const r = Math.min(Math.max(1, roundIdx), Math.max(1, R));
  const rt = result?.fed.rounds[r - 1];
  const prevMetrics = result ? (r === 1 ? result.fed.initMetrics : result.fed.rounds[r - 2].metrics) : null;

  const curve = useMemo(() => {
    if (!result) return [];
    return [{ ronda: 0, acc: result.fed.initMetrics.testAcc, loss: result.fed.initMetrics.testLoss, train: result.fed.initMetrics.trainLoss }, ...result.fed.rounds.map((x) => ({ ronda: x.round, acc: x.metrics.testAcc, loss: x.metrics.testLoss, train: x.metrics.trainLoss }))];
  }, [result]);

  const lines: BoundaryLine[] = rt
    ? [
        ...(stepper.step >= 2 ? rt.updates.map((u) => ({ params: u.endParams, color: clientColor(u.clientId), label: `w local · ${result!.data.clients[u.clientId].name}`, dashed: true, width: 1.2 })) : []),
        { params: rt.globalBefore, color: C.muted, label: `Global (ronda ${r - 1})`, dashed: true, width: 1 },
        ...(stepper.step >= 4 ? [{ params: rt.globalAfter, color: C.fg, label: `Global (ronda ${r})`, width: 2.2 }] : []),
      ]
    : [];
  const scatterSamples = result ? (view === 'test' ? result.data.globalTest : result.data.clients[view].train) : [];

  return (
    <ExperimentLayout
      experimentId={ID}
      module="fl"
      kicker="Experimento 2"
      title={TITLE}
      objective="Ejecutar Federated Averaging paso a paso e inspeccionar numéricamente los parámetros locales, los pesos de agregación y el modelo global resultante."
      badges={['real', 'sim']}
      intro={
        <>
          <p>
            Imagina {params.numClients} hospitales con distinto número de pacientes. En cada <Term k="round">ronda</Term>, el servidor envía el modelo actual, algunos hospitales entrenan unas <Term k="localEpochs">épocas locales</Term> y devuelven su modelo. El servidor
            calcula una media ponderada: un hospital con el doble de pacientes pesa el doble. Eso es <Term k="fedavg">FedAvg</Term> (McMahan et al., 2017).
          </p>
          <p>
            Pulsa «Ejecutar» y recorre los seis pasos de cada ronda. Todas las cifras que ves provienen de la simulación real ejecutada en tu navegador sobre una <Term k="logistic">regresión logística</Term> con dos biomarcadores sintéticos ({FEATURE_NAMES.join(' y ')}).
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="Clientes y datos">
            <ParamSlider label="Número de clientes" ariaLabel="Número de clientes" value={params.numClients} onChange={(v) => set('numClients', Math.round(v))} min={2} max={10} step={1} />
            <ParamSlider label="Muestras por cliente" ariaLabel="Muestras por cliente" value={params.samplesPerClient} onChange={(v) => set('samplesPerClient', Math.round(v))} min={20} max={600} step={10} />
            <ParamSlider label="Asimetría de tamaños" ariaLabel="Asimetría de tamaños" value={params.sizeSkew} onChange={(v) => set('sizeSkew', v)} min={0} max={1} step={0.05} help="0 = todos los clientes con el mismo n_k; valores altos hacen que los pesos n_k/N difieran." />
            <ParamChoice label={<Term k="iid">Distribución de los datos</Term>} value={params.mode} options={['iid', 'non-iid'] as const} format={(v) => (v === 'iid' ? 'IID' : 'Non-IID')} onChange={(v) => set('mode', v)} help="Non-IID usa desequilibrio de clases y desplazamiento de características (Experimento 3)." />
          </ConfigSection>
          <ConfigSection title="Federated Averaging">
            <ParamSlider label={<Term k="round">Rondas de comunicación</Term>} ariaLabel="Rondas de comunicación" value={params.rounds} onChange={(v) => set('rounds', Math.round(v))} min={1} max={50} step={1} />
            <ParamSlider label={<Term k="localEpochs">Épocas locales</Term>} ariaLabel="Épocas locales" value={params.localEpochs} onChange={(v) => set('localEpochs', Math.round(v))} min={1} max={20} step={1} />
            <ParamSlider label={<Term k="learningRate">Tasa de aprendizaje local</Term>} ariaLabel="Tasa de aprendizaje local" value={params.localLr} onChange={(v) => set('localLr', v)} min={0.01} max={2} step={0.01} />
            <ParamSlider label={<Term k="batchSize">Tamaño de lote</Term>} ariaLabel="Tamaño de lote" value={params.batchSize} onChange={(v) => set('batchSize', Math.round(v))} min={1} max={128} step={1} />
            <ParamSlider
              label={<Term k="participation">Participación de clientes</Term>}
              ariaLabel="Participación de clientes"
              value={params.participationPct}
              onChange={(v) => set('participationPct', Math.round(v))}
              min={10}
              max={100}
              step={5}
              unit="%"
              help={`m = ${numSelected(params.numClients, params.participationPct / 100)} clientes por ronda.`}
            />
            <SeedControl value={params.seed} onChange={(v) => set('seed', v)} />
          </ConfigSection>
          <ErrorList errors={errors} />
          <Button className="w-full" variant="fl" disabled={errors.length > 0} onClick={() => execute(true)}>
            <Play /> Ejecutar FedAvg
          </Button>
        </>
      }
      visual={
        result && rt && prevMetrics ? (
          <>
            <VisualCard
              title={`Ronda ${r} de ${R} — Paso ${stepper.step + 1}: ${STEPS[stepper.step]}`}
              actions={
                <>
                  <label className="flex items-center gap-1 text-xs">
                    Ronda
                    <select className="h-7 rounded-md border border-input bg-card px-1 text-xs" value={r} onChange={(e) => { setRoundIdx(Number(e.target.value)); stepper.setStep(0); }} aria-label="Seleccionar ronda">
                      {result.fed.rounds.map((x) => (
                        <option key={x.round} value={x.round}>
                          {x.round}
                        </option>
                      ))}
                    </select>
                  </label>
                  <StepControls stepper={stepper} count={STEPS.length} label="pasos de la ronda" />
                </>
              }
            >
              <ol className="mb-4 grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label="Pasos de la ronda">
                {STEPS.map((s, i) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => stepper.setStep(i)}
                      aria-current={i === stepper.step ? 'step' : undefined}
                      className={cn('w-full rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors', i === stepper.step ? 'border-fl bg-fl/10 font-semibold' : i < stepper.step ? 'bg-muted' : 'hover:bg-accent')}
                    >
                      <span className="num block text-[10px] text-muted-foreground">Paso {i + 1}</span>
                      {s}
                    </button>
                  </li>
                ))}
              </ol>
              <motion.div key={`${r}-${stepper.step}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <StepView step={stepper.step} rt={rt} data={result.data} prevRt={prevMetrics} />
              </motion.div>
            </VisualCard>
            <div className="grid gap-4 md:grid-cols-2">
              <VisualCard title="Fronteras de decisión" description="Modelos locales (discontinuas, aparecen en el Paso 3) y global (continua, Paso 5).">
                <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Datos mostrados">
                  <Button size="sm" variant={view === 'test' ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => setView('test')}>
                    Test global
                  </Button>
                  {result.data.clients.map((_c, k) => (
                    <Button key={k} size="sm" variant={view === k ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => setView(k)}>
                      C{k + 1}
                    </Button>
                  ))}
                </div>
                <ClientScatter samples={scatterSamples} lines={lines} title={view === 'test' ? 'Conjunto de evaluación global' : `Datos de entrenamiento de ${result.data.clients[view].name}`} size={260} maxPoints={400} />
                <div className="mt-2">
                  <ScatterLegend lines={lines.filter((l) => !l.label.startsWith('w local')).concat(stepper.step >= 2 ? [{ params: [], color: C.muted, label: 'Modelos locales (color del cliente)', dashed: true }] : [])} />
                </div>
              </VisualCard>
              <VisualCard title="Evolución del modelo global">
                <ChartFrame
                  title="Precisión y pérdida por ronda"
                  description="Precisión y pérdida del modelo global en el conjunto de evaluación fijo; la línea vertical marca la ronda inspeccionada."
                  height={230}
                  data={curve}
                  columns={[
                    { key: 'ronda', label: 'Ronda' },
                    { key: 'acc', label: 'Precisión test', format: (v) => pct(v as number) },
                    { key: 'loss', label: 'Pérdida test', format: (v) => f(v as number, 4) },
                    { key: 'train', label: 'Pérdida entrenamiento', format: (v) => f(v as number, 4) },
                  ]}
                >
                  <LineChart data={curve} margin={{ top: 5, right: 0, left: -12, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="ronda" {...axisProps} />
                    <YAxis yAxisId="a" {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                    <YAxis yAxisId="l" orientation="right" {...axisProps} tickFormatter={(v) => f(v, 2)} />
                    <RTooltip {...tooltipProps} formatter={(v, n) => (n === 'Precisión test' ? pct(v as number) : f(v as number, 4))} labelFormatter={(l) => `Ronda ${l}`} />
                    <Legend {...legendProps} />
                    <ReferenceLine yAxisId="a" x={r} stroke={C.warn} strokeDasharray="4 3" />
                    <Line yAxisId="a" type="monotone" dataKey="acc" name="Precisión test" stroke={C.fl} strokeWidth={2} dot={false} />
                    <Line yAxisId="l" type="monotone" dataKey="loss" name="Pérdida test" stroke={C.c3} strokeWidth={1.6} dot={false} />
                  </LineChart>
                </ChartFrame>
              </VisualCard>
            </div>
          </>
        ) : (
          <ErrorList errors={errors.length ? errors : []} />
        )
      }
      observations={
        result && rt ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Precisión inicial" value={pct(result.fed.initMetrics.testAcc)} />
              <StatTile label="Precisión final" value={pct(result.fed.rounds[R - 1].metrics.testAcc)} tone="fl" />
              <StatTile label="Clientes por ronda" value={`${rt.selected.length} / ${result.data.clients.length}`} />
              <StatTile label="Comunicación total" value={formatBytes(result.fed.totalBytes)} />
            </div>
            <p className="text-[13px] leading-relaxed">
              En la ronda {r} la norma media de las actualizaciones fue <span className="num font-semibold">{f(rt.updates.reduce((s, u) => s + u.deltaNorm, 0) / rt.updates.length, 4)}</span>. A medida que el modelo converge, las actualizaciones suelen hacerse más
              pequeñas.
            </p>
            {result.params.participationPct < 100 && (
              <Callout kind="info">Con participación parcial, cada ronda agrega un subconjunto distinto de clientes: el modelo global puede oscilar más entre rondas.</Callout>
            )}
            {result.params.mode === 'non-iid' && <Callout kind="info">Con datos Non-IID, compara las fronteras locales: cada cliente tira del modelo hacia su propio óptimo (deriva de clientes).</Callout>}
            <Callout kind="warn">El servidor ve cada w<sub>k</sub> individual en el Paso 4. FedAvg no incluye por sí mismo ninguna protección de privacidad.</Callout>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Ejecuta la simulación para ver las observaciones.</p>
        )
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(run) => { const p = fromLabelled(run.params, LABELS, DEFAULTS); setParams(p); execute(false, p); }} onReset={resetParams} />}
      details={
        result && rt ? (
          <ShowCalculations
            equations={[
              'Actualización local (SGD): θ ← θ − η · (1/B) Σ_{i∈lote} (σ(θᵀx̃_i) − y_i) · x̃_i,   x̃ = [x₁, x₂, 1]',
              `Agregación: w_global = Σ_k (n_k / N) · w_k,   N = ${rt.N}`,
              'Pérdida: ℓ(θ) = −(1/n) Σ [y log σ(θᵀx̃) + (1 − y) log(1 − σ(θᵀx̃))]',
            ]}
            inputs={[
              { label: 'Ronda inspeccionada', value: r },
              { label: 'Clientes seleccionados', value: rt.selected.map((k) => `C${k + 1}`).join(', ') },
              { label: 'n_k de los participantes', value: rt.updates.map((u) => u.nSamples).join(', ') },
              { label: 'Épocas locales × tamaño de lote', value: `${result.params.localEpochs} × ${result.params.batchSize}` },
              { label: 'η local', value: result.params.localLr },
            ]}
            intermediates={rt.updates.map((u, i) => ({ label: `w_${u.clientId + 1} (peso ${f(rt.weights[i].weight, 3)})`, value: `[${u.endParams.map((v) => f(v, 4)).join(', ')}]` }))}
            outputs={[
              { label: 'w_global antes', value: `[${rt.globalBefore.map((v) => f(v, 4)).join(', ')}]` },
              { label: 'w_global después', value: `[${rt.globalAfter.map((v) => f(v, 4)).join(', ')}]` },
              { label: 'Precisión test global', value: pct(rt.metrics.testAcc, 2) },
              { label: 'Evaluaciones de gradiente (ronda)', value: rt.updates.reduce((s, u) => s + u.gradEvals, 0) },
            ]}
            assumptions={['Cada cliente baraja sus datos con una semilla derivada de (semilla, ronda, cliente).', 'Los clientes no seleccionados no entrenan ni reciben el modelo en esa ronda.', 'El conjunto de evaluación global es fijo y no lo ven los clientes durante el entrenamiento.']}
          />
        ) : null
      }
      prosCons={{
        benefits: ['Algoritmo simple: solo requiere enviar parámetros y hacer una media ponderada.', 'Permite varias épocas locales por ronda, reduciendo el número de rondas necesarias.', 'Tolera participación parcial de clientes.'],
        limitations: ['Las actualizaciones individuales son visibles para el servidor.', 'Con datos heterogéneos y muchas épocas locales aparece la deriva de clientes.', 'La ponderación por n_k requiere que los clientes declaren honestamente su tamaño.'],
      }}
      reflection={{
        question: '¿Qué ocurriría con el modelo global si un cliente con muchísimas muestras tuviera datos muy distintos al resto? ¿Es la ponderación por n_k siempre deseable?',
        hint: 'Prueba con Non-IID y fíjate en los pesos del Paso 5 y en la precisión por cliente del Paso 6.',
      }}
    />
  );
}
