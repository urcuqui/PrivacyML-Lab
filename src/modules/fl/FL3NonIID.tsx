import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, LineChart, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamChoice, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { ContextualCheck } from '@/components/lab/PrivacyModel';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { runSimTask } from '@/lib/useSimTask';
import type { ModeSummary } from '@/lib/tasks';
import { mean, std } from '@/lib/stats';
import { DEFAULT_DATA_CONFIG, REFERENCE_POPULATION, REFERENCE_SEED, generateFederatedData, validateDataConfig, type FederatedDataConfig } from '@/lib/fl/data';
import { numSelected, validateFedConfig, type FedAvgConfig } from '@/lib/fl/fedavg';
import { ClientScatter, ScatterLegend, f, fromLabelled, pct, toLabelled } from './shared';

const ID = 'fl3';
const TITLE = 'Datos IID frente a Non-IID';

interface Params {
  numClients: number;
  samplesPerClient: number;
  classImbalance: number;
  featureShift: number;
  sizeSkew: number;
  participationPct: number;
  rounds: number;
  localEpochs: number;
  localLr: number;
  repeats: number;
  seed: number;
}
const DEFAULTS: Params = { numClients: 5, samplesPerClient: 100, classImbalance: 0.9, featureShift: 2, sizeSkew: 0.3, participationPct: 100, rounds: 20, localEpochs: 5, localLr: 0.3, repeats: 5, seed: 42 };
const LABELS: Record<keyof Params, string> = {
  numClients: 'Clientes',
  samplesPerClient: 'Muestras por cliente',
  classImbalance: 'Desequilibrio de clases',
  featureShift: 'Desplazamiento de características',
  sizeSkew: 'Asimetría de tamaños',
  participationPct: 'Participación (%)',
  rounds: 'Rondas',
  localEpochs: 'Épocas locales',
  localLr: 'Tasa de aprendizaje local',
  repeats: 'Repeticiones',
  seed: 'Semilla',
};

const dataCfg = (p: Params, mode: 'iid' | 'non-iid' = 'non-iid'): FederatedDataConfig => ({
  ...DEFAULT_DATA_CONFIG,
  numClients: p.numClients,
  samplesPerClient: p.samplesPerClient,
  classImbalance: p.classImbalance,
  featureShift: p.featureShift,
  sizeSkew: p.sizeSkew,
  mode,
  seed: p.seed,
});
const fedCfg = (p: Params): FedAvgConfig => ({ rounds: p.rounds, localEpochs: p.localEpochs, localLr: p.localLr, batchSize: 16, participation: p.participationPct / 100, seed: p.seed, dp: null });

interface Result {
  params: Params;
  summaries: ModeSummary[];
}

/** Primera ronda en la que la pérdida media recorre el 95 % de su caída total (sobre la curva media). */
function lossConvergenceRound(s: ModeSummary): number {
  const L0 = s.perRound[0].lossMean;
  const Lf = s.perRound[s.perRound.length - 1].lossMean;
  const thr = Lf + 0.05 * (L0 - Lf);
  return s.perRound.find((r) => r.round > 0 && r.lossMean <= thr)?.round ?? s.perRound.length - 1;
}

const MODE_LABEL = { iid: 'IID', 'non-iid': 'Non-IID' } as const;
type EvalView = 'scenario' | 'reference';
const EVAL_LABEL: Record<EvalView, string> = { scenario: 'Propia de cada escenario', reference: 'Referencia común' };
const REF_SIZE = DEFAULT_DATA_CONFIG.referenceTestSize ?? DEFAULT_DATA_CONFIG.globalTestSize;

/** Compara Non-IID frente a IID con un umbral de ruido basado en la variabilidad entre repeticiones. */
function compareModes(iidAccs: number[], nonAccs: number[]) {
  const diff = mean(nonAccs) - mean(iidAccs);
  const noise = Math.max(std(iidAccs), std(nonAccs), 0.005);
  const kind: 'similar' | 'worse' | 'better' = Math.abs(diff) <= noise ? 'similar' : diff < 0 ? 'worse' : 'better';
  const label = kind === 'similar' ? 'similar (dentro de la variabilidad entre repeticiones)' : kind === 'worse' ? 'peor con Non-IID' : 'mejor con Non-IID';
  return { diff, noise, kind, label };
}
const MODE_COLOR = { iid: C.c1, 'non-iid': C.c4 } as const;

export default function FL3NonIID() {
  const [params, setParams, resetParams] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [result, setResult] = usePersistentState<Result | null>(`${ID}.result`, null, false);
  const [evalView, setEvalView] = usePersistentState<EvalView>(`${ID}.evalView`, 'scenario');
  const [running, setRunning] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const { addRun } = useRuns(ID);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const errors = useMemo(() => {
    const e = [...validateDataConfig(dataCfg(params)), ...validateFedConfig(fedCfg(params))];
    if (!Number.isInteger(params.repeats) || params.repeats < 1 || params.repeats > 20) e.push('Las repeticiones deben estar entre 1 y 20.');
    return e;
  }, [params]);

  // Vista previa de los datos (semilla base) para ambos modos.
  const preview = useMemo(() => {
    if (validateDataConfig(dataCfg(params)).length) return null;
    return { iid: generateFederatedData(dataCfg(params, 'iid')), noniid: generateFederatedData(dataCfg(params, 'non-iid')) };
  }, [params]);

  const execute = useCallback(
    async (record: boolean, p: Params = params) => {
      setRunning(true);
      setTaskError(null);
      try {
        const summaries = await runSimTask('iidCompare', { data: dataCfg(p), fed: fedCfg(p), repeats: p.repeats });
        setResult({ params: p, summaries });
        if (record) {
          const [iid, non] = summaries;
          addRun({
            experimentTitle: TITLE,
            seed: p.seed,
            params: toLabelled(p, LABELS),
            results: {
              'Precisión final IID (media)': mean(iid.finalAcc),
              'Precisión final IID (desv.)': std(iid.finalAcc),
              'Precisión final Non-IID (media)': mean(non.finalAcc),
              'Precisión final Non-IID (desv.)': std(non.finalAcc),
              'Precisión final IID en referencia común (media)': mean(iid.finalRefAcc),
              'Precisión final IID en referencia común (desv.)': std(iid.finalRefAcc),
              'Precisión final Non-IID en referencia común (media)': mean(non.finalRefAcc),
              'Precisión final Non-IID en referencia común (desv.)': std(non.finalRefAcc),
              'Rondas hasta convergencia de la pérdida IID': lossConvergenceRound(iid),
              'Rondas hasta convergencia de la pérdida Non-IID': lossConvergenceRound(non),
            },
            dataConfig: {
              Clientes: p.numClients,
              'Muestras por cliente': p.samplesPerClient,
              'Desequilibrio de clases (Non-IID)': p.classImbalance,
              'Desplazamiento de características (Non-IID)': p.featureShift,
              'Asimetría de tamaños': p.sizeSkew,
              'Tamaño del test del escenario': DEFAULT_DATA_CONFIG.globalTestSize,
              'Población de referencia': REFERENCE_POPULATION.description,
              'Semilla del conjunto de referencia': REFERENCE_SEED,
              'Tamaño del conjunto de referencia': REF_SIZE,
            },
            assumptions: [
              'Cada repetición genera datos nuevos (semilla derivada) para ambos modos.',
              'Evaluación del escenario: cada modo se evalúa en su propio conjunto global, mezcla equilibrada de las distribuciones de SUS clientes.',
              `Evaluación de referencia: conjunto común fijo (semilla ${REFERENCE_SEED}, ${REF_SIZE} ejemplos, clases equilibradas, sin desplazamiento), idéntico para ambos modos y todas las repeticiones e independiente de los datos de entrenamiento. Coincide con la distribución de entrenamiento IID.`,
              'Non-IID: proporción de positivos y desplazamiento de medias distintos por cliente.',
            ],
            limitations: ['Resultados empíricos dependientes de la generación sintética.', 'Modelo lineal convexo; las redes profundas pueden sufrir más la deriva.', 'No implica que Non-IID siempre empeore el resultado.'],
            privacyGuarantee: null,
          });
        }
      } catch (e) {
        setTaskError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [params, setResult, addRun],
  );

  useEffect(() => {
    if (!result && !errors.length) void execute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iid = result?.summaries.find((s) => s.mode === 'iid');
  const non = result?.summaries.find((s) => s.mode === 'non-iid');

  const accData = useMemo(() => {
    if (!iid || !non) return [];
    return iid.perRound.map((a, t) => {
      const b = non.perRound[t];
      return {
        ronda: a.round,
        iid: a.accMean,
        non: b.accMean,
        iidBand: [a.accMean - a.accStd, a.accMean + a.accStd] as [number, number],
        nonBand: [b.accMean - b.accStd, b.accMean + b.accStd] as [number, number],
        iidStd: a.accStd,
        nonStd: b.accStd,
        iidRef: a.refAccMean,
        nonRef: b.refAccMean,
        iidRefBand: [a.refAccMean - a.refAccStd, a.refAccMean + a.refAccStd] as [number, number],
        nonRefBand: [b.refAccMean - b.refAccStd, b.refAccMean + b.refAccStd] as [number, number],
        iidRefStd: a.refAccStd,
        nonRefStd: b.refAccStd,
        iidLoss: a.lossMean,
        nonLoss: b.lossMean,
      };
    });
  }, [iid, non]);

  const clientData = useMemo(() => {
    if (!iid || !non || !preview) return [];
    return iid.perClientAccMean.map((_, k) => ({
      cliente: `C${k + 1}`,
      nombre: preview.iid.clients[k].name,
      iid: iid.perClientAccMean[k],
      iidErr: iid.perClientAccStd[k],
      non: non.perClientAccMean[k],
      nonErr: non.perClientAccStd[k],
    }));
  }, [iid, non, preview]);

  const rateData = useMemo(() => {
    if (!preview) return [];
    return preview.iid.clients.map((c, k) => ({
      cliente: `C${k + 1}`,
      iid: c.positiveRate,
      non: preview.noniid.clients[k].positiveRate,
      n: c.train.length,
    }));
  }, [preview]);

  const cmpScenario = iid && non ? compareModes(iid.finalAcc, non.finalAcc) : null;
  const cmpRef = iid && non ? compareModes(iid.finalRefAcc, non.finalRefAcc) : null;
  const cmpView = evalView === 'scenario' ? cmpScenario : cmpRef;
  const isRef = evalView === 'reference';
  const k = isRef ? { iid: 'iidRef', non: 'nonRef', iidBand: 'iidRefBand', nonBand: 'nonRefBand', iidStd: 'iidRefStd', nonStd: 'nonRefStd' } : { iid: 'iid', non: 'non', iidBand: 'iidBand', nonBand: 'nonBand', iidStd: 'iidStd', nonStd: 'nonStd' };
  const finalOf = (s: ModeSummary) => (isRef ? s.finalRefAcc : s.finalAcc);
  const evalCompareData =
    iid && non
      ? (['scenario', 'reference'] as const).map((v) => {
          const a = v === 'scenario' ? iid.finalAcc : iid.finalRefAcc;
          const b = v === 'scenario' ? non.finalAcc : non.finalRefAcc;
          return { evaluacion: EVAL_LABEL[v], iid: mean(a), iidErr: std(a), non: mean(b), nonErr: std(b), brecha: mean(b) - mean(a) };
        })
      : [];
  const gapChanged = cmpScenario && cmpRef ? cmpScenario.kind !== cmpRef.kind : false;
  const spread = (s: ModeSummary) => Math.max(...s.perClientAccMean) - Math.min(...s.perClientAccMean);

  return (
    <ExperimentLayout
      experimentId={ID}
      module="fl"
      kicker="Experimento 3"
      title={TITLE}
      objective="Comparar el comportamiento de FedAvg cuando los clientes tienen distribuciones parecidas (IID) y distintas (Non-IID), y entender la deriva de clientes y la variabilidad entre ejecuciones."
      badges={['empirical', 'sim', 'real']}
      intro={
        <>
          <p>
            En la vida real, un hospital pediátrico y uno geriátrico no ven a los mismos pacientes: uno puede tener casi todos los casos de riesgo bajo, otro casi todos de riesgo alto, y los valores típicos de los biomarcadores también cambian. Sus datos son{' '}
            <Term k="nonIid">Non-IID</Term>.
          </p>
          <p>
            Cuando cada cliente entrena varias <Term k="localEpochs">épocas locales</Term> sobre datos tan distintos, su modelo se mueve hacia <em>su</em> óptimo local. Al promediar modelos que han tirado en direcciones diferentes aparece la{' '}
            <Term k="clientDrift">deriva de clientes</Term>, que puede ralentizar o desestabilizar la convergencia.
          </p>
          <p>
            Pero cuidado: <strong>Non-IID no siempre produce peores resultados</strong>. Depende del modelo, del tipo de heterogeneidad y de los hiperparámetros. Aquí lo comprobarás con varias repeticiones en lugar de fiarte de una sola ejecución.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="Heterogeneidad (Non-IID)">
            <ParamSlider label="Desequilibrio de clases" ariaLabel="Desequilibrio de clases" value={params.classImbalance} onChange={(v) => set('classImbalance', v)} min={0} max={1} step={0.05} help="0 = todos con 50 % de positivos; 1 = de ~5 % a ~95 % según el cliente." />
            <ParamSlider label="Desplazamiento de características" ariaLabel="Desplazamiento de características" value={params.featureShift} onChange={(v) => set('featureShift', v)} min={0} max={5} step={0.1} help="Desplaza las medias de los biomarcadores de cada cliente." />
            <ParamSlider label="Asimetría de tamaños" ariaLabel="Asimetría de tamaños" value={params.sizeSkew} onChange={(v) => set('sizeSkew', v)} min={0} max={1} step={0.05} help="Se aplica en ambos modos." />
          </ConfigSection>
          <ConfigSection title="Clientes">
            <ParamSlider label="Número de clientes" ariaLabel="Número de clientes" value={params.numClients} onChange={(v) => set('numClients', Math.round(v))} min={2} max={10} step={1} />
            <ParamSlider label="Muestras por cliente" ariaLabel="Muestras por cliente" value={params.samplesPerClient} onChange={(v) => set('samplesPerClient', Math.round(v))} min={20} max={500} step={10} />
            <ParamSlider
              label={<Term k="participation">Participación</Term>}
              ariaLabel="Participación de clientes"
              value={params.participationPct}
              onChange={(v) => set('participationPct', Math.round(v))}
              min={10}
              max={100}
              step={5}
              unit="%"
              help={`${numSelected(params.numClients, params.participationPct / 100)} clientes participantes por ronda.`}
            />
          </ConfigSection>
          <ConfigSection title="Entrenamiento (igual en ambos modos)">
            <ParamSlider label={<Term k="round">Rondas</Term>} ariaLabel="Rondas" value={params.rounds} onChange={(v) => set('rounds', Math.round(v))} min={2} max={60} step={1} />
            <ParamSlider label={<Term k="localEpochs">Épocas locales</Term>} ariaLabel="Épocas locales" value={params.localEpochs} onChange={(v) => set('localEpochs', Math.round(v))} min={1} max={30} step={1} />
            <ParamSlider label={<Term k="learningRate">Tasa de aprendizaje local</Term>} ariaLabel="Tasa de aprendizaje local" value={params.localLr} onChange={(v) => set('localLr', v)} min={0.01} max={2} step={0.01} />
            <ParamSlider label="Repeticiones" ariaLabel="Repeticiones" value={params.repeats} onChange={(v) => set('repeats', Math.round(v))} min={1} max={20} step={1} help="Cada repetición usa datos y barajados nuevos para medir la variabilidad." />
            <SeedControl value={params.seed} onChange={(v) => set('seed', v)} />
          </ConfigSection>
          <ErrorList errors={errors} />
          {taskError && <ErrorList errors={[taskError]} />}
          <Button className="w-full" variant="fl" disabled={errors.length > 0 || running} onClick={() => void execute(true)}>
            {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? 'Ejecutando…' : 'Ejecutar ambos escenarios'}
          </Button>
        </>
      }
      visual={
        <>
          {preview && (
            <VisualCard title="Datos de cada cliente" description="Vista previa con la semilla base (cada repetición genera datos nuevos con la misma configuración).">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] table-fixed text-xs">
                  <thead>
                    <tr>
                      <th scope="col" className="w-16 py-1 text-left font-medium text-muted-foreground">Modo</th>
                      {preview.iid.clients.map((c, k) => (
                        <th key={k} scope="col" className="px-0.5 py-1 text-center font-medium" title={c.name}>
                          C{k + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['iid', 'noniid'] as const).map((m) => (
                      <tr key={m}>
                        <th scope="row" className="py-1 text-left font-medium">
                          {m === 'iid' ? 'IID' : 'Non-IID'}
                        </th>
                        {preview[m].clients.map((c, k) => (
                          <td key={k} className="px-0.5 py-1 align-top">
                            <ClientScatter samples={c.train} title={`${c.name}, ${m === 'iid' ? 'IID' : 'Non-IID'}`} size={110} L={6} maxPoints={150} />
                            <div className="num mt-0.5 text-center text-[10px] text-muted-foreground">
                              n={c.train.length} · {pct(c.positiveRate, 0)}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2">
                <ScatterLegend />
              </div>
              <div className="mt-3">
                <ChartFrame
                  title="Proporción de clase 1 (riesgo alto) por cliente"
                  description="Fracción de ejemplos positivos en los datos de entrenamiento de cada cliente en ambos modos."
                  height={170}
                  data={rateData}
                  columns={[
                    { key: 'cliente', label: 'Cliente' },
                    { key: 'n', label: 'n' },
                    { key: 'iid', label: 'IID', format: (v) => pct(v as number) },
                    { key: 'non', label: 'Non-IID', format: (v) => pct(v as number) },
                  ]}
                >
                  <BarChart data={rateData} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="cliente" {...axisProps} />
                    <YAxis {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                    <RTooltip {...tooltipProps} formatter={(v) => pct(v as number)} />
                    <Legend {...legendProps} />
                    <Bar dataKey="iid" name="IID" fill={MODE_COLOR.iid} />
                    <Bar dataKey="non" name="Non-IID" fill={MODE_COLOR['non-iid']} />
                  </BarChart>
                </ChartFrame>
              </div>
            </VisualCard>
          )}
          {iid && non && (
            <>
              <VisualCard
                title="Convergencia del modelo global"
                description={`Media ± 1 desviación estándar sobre ${result!.params.repeats} repeticiones. Evaluación: ${EVAL_LABEL[evalView].toLowerCase()}.`}
                actions={
                  <div role="radiogroup" aria-label="Distribución de evaluación" className="flex gap-1">
                    {(['scenario', 'reference'] as const).map((v) => (
                      <Button key={v} size="sm" variant={evalView === v ? 'default' : 'outline'} role="radio" aria-checked={evalView === v} className="h-7 text-xs" onClick={() => setEvalView(v)}>
                        {EVAL_LABEL[v]}
                      </Button>
                    ))}
                  </div>
                }
              >
                <ChartFrame
                  title={isRef ? 'Precisión global por ronda — referencia común' : 'Precisión global por ronda — evaluación de cada escenario'}
                  description={
                    isRef
                      ? 'Precisión media del modelo global en el MISMO conjunto de referencia para ambos modos, con banda de ± una desviación estándar entre repeticiones.'
                      : 'Precisión media del modelo global en el conjunto de evaluación propio de cada modo (mezcla de sus clientes), con banda de ± una desviación estándar entre repeticiones.'
                  }
                  data={accData}
                  columns={[
                    { key: 'ronda', label: 'Ronda' },
                    { key: k.iid as 'iid', label: 'IID media', format: (v) => pct(v as number, 2) },
                    { key: k.iidStd as 'iidStd', label: 'IID desv.', format: (v) => pct(v as number, 2) },
                    { key: k.non as 'non', label: 'Non-IID media', format: (v) => pct(v as number, 2) },
                    { key: k.nonStd as 'nonStd', label: 'Non-IID desv.', format: (v) => pct(v as number, 2) },
                  ]}
                >
                  <ComposedChart data={accData} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="ronda" {...axisProps} />
                    <YAxis {...axisProps} domain={[0.3, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} allowDataOverflow />
                    <RTooltip {...tooltipProps} formatter={(v) => (Array.isArray(v) ? `${pct(v[0] as number)} – ${pct(v[1] as number)}` : pct(v as number, 2))} labelFormatter={(l) => `Ronda ${l}`} />
                    <Legend {...legendProps} />
                    <Area dataKey={k.iidBand} name="IID ± desv." fill={MODE_COLOR.iid} fillOpacity={0.15} stroke="none" isAnimationActive={false} />
                    <Area dataKey={k.nonBand} name="Non-IID ± desv." fill={MODE_COLOR['non-iid']} fillOpacity={0.15} stroke="none" isAnimationActive={false} />
                    <Line dataKey={k.iid} name="IID" stroke={MODE_COLOR.iid} strokeWidth={2} dot={false} />
                    <Line dataKey={k.non} name="Non-IID" stroke={MODE_COLOR['non-iid']} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ChartFrame>
              </VisualCard>
              <VisualCard
                title="¿Dónde se evalúa? Escenario frente a referencia común"
                description="Precisión final (media ± desv. entre repeticiones) de cada modo en las dos distribuciones de evaluación."
                actions={<IntegrityBadge kind="empirical" />}
              >
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <ChartFrame
                    title="Precisión final por distribución de evaluación"
                    description="Barras: media; líneas de error: ± una desviación estándar entre repeticiones."
                    height={220}
                    data={evalCompareData}
                    columns={[
                      { key: 'evaluacion', label: 'Evaluación', format: (v) => String(v) },
                      { key: 'iid', label: 'IID media', format: (v) => pct(v as number, 2) },
                      { key: 'iidErr', label: 'IID desv.', format: (v) => pct(v as number, 2) },
                      { key: 'non', label: 'Non-IID media', format: (v) => pct(v as number, 2) },
                      { key: 'nonErr', label: 'Non-IID desv.', format: (v) => pct(v as number, 2) },
                      { key: 'brecha', label: 'Non-IID − IID (pp)', format: (v) => f((v as number) * 100, 2) },
                    ]}
                  >
                    <BarChart data={evalCompareData} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="evaluacion" {...axisProps} />
                      <YAxis {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                      <RTooltip {...tooltipProps} formatter={(v) => pct(v as number, 2)} />
                      <Legend {...legendProps} />
                      <Bar dataKey="iid" name="IID" fill={MODE_COLOR.iid}>
                        <ErrorBar dataKey="iidErr" stroke={C.fg} width={3} />
                      </Bar>
                      <Bar dataKey="non" name="Non-IID" fill={MODE_COLOR['non-iid']}>
                        <ErrorBar dataKey="nonErr" stroke={C.fg} width={3} />
                      </Bar>
                    </BarChart>
                  </ChartFrame>
                  <div className="space-y-2 text-[13px] leading-relaxed">
                    <table className="w-full text-xs">
                      <caption className="sr-only">Precisión final por modo y distribución de evaluación</caption>
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th scope="col" className="py-1 text-left font-medium">Evaluación</th>
                          <th scope="col" className="py-1 text-right font-medium">IID</th>
                          <th scope="col" className="py-1 text-right font-medium">Non-IID</th>
                          <th scope="col" className="py-1 text-right font-medium">Conclusión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['scenario', 'reference'] as const).map((v) => {
                          const a = v === 'scenario' ? iid.finalAcc : iid.finalRefAcc;
                          const b = v === 'scenario' ? non.finalAcc : non.finalRefAcc;
                          const c = v === 'scenario' ? cmpScenario! : cmpRef!;
                          return (
                            <tr key={v} className="border-b last:border-0">
                              <th scope="row" className="py-1 text-left font-normal">{EVAL_LABEL[v]}</th>
                              <td className="num py-1 text-right">{pct(mean(a))} ± {pct(std(a))}</td>
                              <td className="num py-1 text-right">{pct(mean(b))} ± {pct(std(b))}</td>
                              <td className="py-1 text-right">{c.label}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="rounded-md bg-muted p-2 text-xs">
                      <strong>Población de referencia:</strong> {REFERENCE_POPULATION.description} {REF_SIZE} ejemplos generados con su propia semilla ({REFERENCE_SEED}), independiente de la semilla de los datos, del modo y del número de clientes:
                      es el mismo conjunto para IID, Non-IID y todas las repeticiones, y nunca se usa para entrenar. <em>Advertencia:</em> coincide con la distribución de entrenamiento del escenario IID, lo que puede favorecer a IID.
                    </p>
                  </div>
                </div>
              </VisualCard>
              <div className="grid gap-4 md:grid-cols-2">
                <VisualCard title="Pérdida de entrenamiento">
                  <ChartFrame
                    title="Pérdida global de entrenamiento"
                    description="Entropía cruzada media (ponderada por n_k) del modelo global sobre los datos de todos los clientes."
                    height={210}
                    data={accData}
                    columns={[
                      { key: 'ronda', label: 'Ronda' },
                      { key: 'iidLoss', label: 'IID', format: (v) => f(v as number, 4) },
                      { key: 'nonLoss', label: 'Non-IID', format: (v) => f(v as number, 4) },
                    ]}
                  >
                    <LineChart data={accData} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="ronda" {...axisProps} />
                      <YAxis {...axisProps} tickFormatter={(v) => f(v, 2)} />
                      <RTooltip {...tooltipProps} formatter={(v) => f(v as number, 4)} labelFormatter={(l) => `Ronda ${l}`} />
                      <Legend {...legendProps} />
                      <Line dataKey="iidLoss" name="IID" stroke={MODE_COLOR.iid} strokeWidth={2} dot={false} />
                      <Line dataKey="nonLoss" name="Non-IID" stroke={MODE_COLOR['non-iid']} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ChartFrame>
                </VisualCard>
                <VisualCard title="Precisión local por cliente">
                  <ChartFrame
                    title="Precisión del modelo global final en el test local de cada cliente"
                    description="Media y desviación estándar entre repeticiones. Revela si el modelo global sirve igual de bien a todos los clientes."
                    height={210}
                    data={clientData}
                    columns={[
                      { key: 'nombre', label: 'Cliente', format: (v) => String(v) },
                      { key: 'iid', label: 'IID media', format: (v) => pct(v as number) },
                      { key: 'iidErr', label: 'IID desv.', format: (v) => pct(v as number) },
                      { key: 'non', label: 'Non-IID media', format: (v) => pct(v as number) },
                      { key: 'nonErr', label: 'Non-IID desv.', format: (v) => pct(v as number) },
                    ]}
                  >
                    <BarChart data={clientData} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="cliente" {...axisProps} />
                      <YAxis {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                      <RTooltip {...tooltipProps} formatter={(v) => pct(v as number)} />
                      <Legend {...legendProps} />
                      <Bar dataKey="iid" name="IID" fill={MODE_COLOR.iid}>
                        <ErrorBar dataKey="iidErr" stroke={C.fg} width={3} />
                      </Bar>
                      <Bar dataKey="non" name="Non-IID" fill={MODE_COLOR['non-iid']}>
                        <ErrorBar dataKey="nonErr" stroke={C.fg} width={3} />
                      </Bar>
                    </BarChart>
                  </ChartFrame>
                </VisualCard>
              </div>
              <VisualCard title="Variabilidad entre repeticiones" description={`Precisión final de cada repetición (observación empírica). Evaluación: ${EVAL_LABEL[evalView].toLowerCase()}.`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th scope="col" className="py-1 text-left font-medium">Modo</th>
                        {finalOf(iid).map((_, i) => (
                          <th key={i} scope="col" className="py-1 text-right font-medium">
                            Rep. {i + 1}
                          </th>
                        ))}
                        <th scope="col" className="py-1 text-right font-medium">Media ± desv.</th>
                        <th scope="col" className="py-1 text-right font-medium">Rondas hasta 95 % precisión final (escenario)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[iid, non].map((s) => (
                        <tr key={s.mode} className="border-b last:border-0">
                          <th scope="row" className="py-1 text-left font-medium" style={{ color: MODE_COLOR[s.mode] }}>
                            {MODE_LABEL[s.mode]}
                          </th>
                          {finalOf(s).map((a, i) => (
                            <td key={i} className="num py-1 text-right">
                              {pct(a)}
                            </td>
                          ))}
                          <td className="num py-1 text-right">
                            {pct(mean(finalOf(s)))} ± {pct(std(finalOf(s)))}
                          </td>
                          <td className="num py-1 text-right">{f(mean(s.roundsTo95), 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </VisualCard>
            </>
          )}
        </>
      }
      observations={
        iid && non ? (
          <>
            <ParamChoice<EvalView> label="Distribución de evaluación" value={evalView} options={['scenario', 'reference'] as const} format={(v) => EVAL_LABEL[v]} onChange={setEvalView} />
            <div className="grid grid-cols-2 gap-2">
              <StatTile label={`Precisión final IID (${isRef ? 'referencia' : 'escenario'})`} value={pct(mean(finalOf(iid)))} sub={`± ${pct(std(finalOf(iid)))}`} />
              <StatTile label={`Precisión final Non-IID (${isRef ? 'referencia' : 'escenario'})`} value={pct(mean(finalOf(non)))} sub={`± ${pct(std(finalOf(non)))}`} tone="warn" />
              <StatTile label="Convergencia de la pérdida (IID)" value={`${lossConvergenceRound(iid)} rondas`} sub="95 % de la caída total" />
              <StatTile label="Convergencia de la pérdida (Non-IID)" value={`${lossConvergenceRound(non)} rondas`} sub="95 % de la caída total" />
            </div>
            <p className="text-[13px] leading-relaxed">
              Evaluando en la {EVAL_LABEL[evalView].toLowerCase()}, el resultado final fue <strong>{cmpView!.label}</strong> (Non-IID − IID = {f(cmpView!.diff * 100, 2)} puntos; umbral de ruido ±{f(cmpView!.noise * 100, 2)}). Con la{' '}
              {EVAL_LABEL[isRef ? 'scenario' : 'reference'].toLowerCase()}: <strong>{(isRef ? cmpScenario! : cmpRef!).label}</strong> ({f((isRef ? cmpScenario! : cmpRef!).diff * 100, 2)} puntos). Dispersión de la precisión entre clientes: IID{' '}
              {pct(spread(iid))}, Non-IID {pct(spread(non))}.
            </p>
            <Callout kind={gapChanged ? 'warn' : 'info'} title={gapChanged ? 'La conclusión cambia según dónde evalúes' : 'Dos preguntas distintas'}>
              La evaluación del escenario responde «¿qué tal sirve el modelo a la población de SUS clientes?»: en Non-IID es una mezcla de distribuciones desplazadas (más dispersa, quizá más difícil o más fácil). La referencia común
              responde «¿cuál de los dos procesos de entrenamiento produce mejor modelo para UNA misma población objetivo?», aislando el efecto de la heterogeneidad del entrenamiento del efecto del conjunto de test.
              {gapChanged && ' En tu ejecución las dos evaluaciones llevan a conclusiones distintas.'}
            </Callout>
            <ContextualCheck
              question="¿Por qué necesitamos evaluar ambos modelos sobre una distribución de referencia común?"
              explanation={
                cmpScenario && cmpRef ? (
                  <>
                    <p>
                      En tu ejecución, con la evaluación de cada escenario la brecha Non-IID − IID es de <strong className="num">{f(cmpScenario.diff * 100, 2)}</strong> puntos ({cmpScenario.label}); sobre la referencia común es de{' '}
                      <strong className="num">{f(cmpRef.diff * 100, 2)}</strong> puntos ({cmpRef.label}).
                    </p>
                    <p>
                      {gapChanged
                        ? 'La conclusión cambia: parte de la diferencia observada en la evaluación por escenario se debía a que los conjuntos de test eran distintos, no solo a cómo se entrenó.'
                        : Math.abs(cmpScenario.diff - cmpRef.diff) > Math.max(cmpScenario.noise, cmpRef.noise)
                          ? 'La conclusión cualitativa se mantiene, pero el tamaño de la brecha cambia más que la variabilidad entre repeticiones: el conjunto de evaluación influye en la magnitud del efecto.'
                          : 'Aquí ambas evaluaciones coinciden (dentro del ruido). Aun así, sin la referencia común no podrías saberlo: con conjuntos de test distintos una diferencia puede deberse al test y no al entrenamiento.'}
                    </p>
                    <p>
                      Al fijar la población de evaluación (mismos {REF_SIZE} ejemplos para ambos modelos), la única diferencia entre IID y Non-IID es el proceso de entrenamiento. Recuerda la advertencia: la referencia coincide con la distribución IID, así que
                      favorece a IID; una referencia distinta (p. ej. la mezcla de clientes Non-IID) podría cambiar de nuevo el resultado.
                    </p>
                  </>
                ) : null
              }
            />
            <Callout kind="warn" title="Non-IID no siempre es peor">
              Con un modelo lineal convexo, FedAvg a veces tolera bien la heterogeneidad. Prueba a subir las épocas locales o el desequilibrio de clases, o bajar la participación, para ver cuándo aparece la deriva.
            </Callout>
          </>
        ) : running ? (
          <p className="text-sm text-muted-foreground" role="status">
            Ejecutando en un Web Worker…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Ejecuta la comparación para ver las observaciones.</p>
        )
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => { const p = fromLabelled(r.params, LABELS, DEFAULTS); setParams(p); void execute(false, p); }} onReset={resetParams} />}
      details={
        iid && non && preview ? (
          <ShowCalculations
            equations={[
              'Non-IID: p_k(y=1) = 0,5 + 0,45 · desequilibrio · t_k,   t_k ∈ [−1, 1] repartido entre clientes',
              'Desplazamiento: x | y ~ N(±(1, 1) + s·(cos φ_k, sin φ_k), I),   φ_k = 2πk/K + 0,3',
              'Rondas hasta 95 % (precisión) = primera ronda con precisión ≥ 0,95 × precisión final (por repetición)',
              'Convergencia de la pérdida = primera ronda con L̄_t ≤ L̄_final + 0,05·(L̄_0 − L̄_final), sobre la curva media',
              'Media ± desviación estándar muestral sobre las repeticiones',
              `Referencia común: x | y ~ generateBlobs(p(y=1) = ${REFERENCE_POPULATION.pPositive}, desplazamiento (0, 0)),  semilla ${REFERENCE_SEED},  ${REF_SIZE} ejemplos`,
              'Conclusión «similar» si |media(Non-IID) − media(IID)| ≤ max(desv. IID, desv. Non-IID, 0,5 pp)',
            ]}
            inputs={[
              { label: 'Clientes · muestras', value: `${result!.params.numClients} · ${result!.params.samplesPerClient}` },
              { label: 'Rondas × épocas locales', value: `${result!.params.rounds} × ${result!.params.localEpochs}` },
              { label: 'Repeticiones', value: result!.params.repeats },
            ]}
            intermediates={preview.noniid.clients.map((c, k) => ({ label: `C${k + 1} Non-IID: p(y=1), desplazamiento`, value: `${f(c.pPositive, 3)}, (${f(c.shift[0], 2)}, ${f(c.shift[1], 2)})` }))}
            outputs={[
              { label: 'IID: precisión final', value: `${pct(mean(iid.finalAcc), 2)} ± ${pct(std(iid.finalAcc), 2)}` },
              { label: 'Non-IID: precisión final', value: `${pct(mean(non.finalAcc), 2)} ± ${pct(std(non.finalAcc), 2)}` },
              { label: 'IID: precisión final (referencia común)', value: `${pct(mean(iid.finalRefAcc), 2)} ± ${pct(std(iid.finalRefAcc), 2)}` },
              { label: 'Non-IID: precisión final (referencia común)', value: `${pct(mean(non.finalRefAcc), 2)} ± ${pct(std(non.finalRefAcc), 2)}` },
              { label: 'Brecha Non-IID − IID (escenario / referencia)', value: `${f(cmpScenario!.diff * 100, 2)} / ${f(cmpRef!.diff * 100, 2)} pp` },
            ]}
            assumptions={[
              'Mismos hiperparámetros de FedAvg en ambos modos.',
              'Evaluación del escenario: conjunto global generado a partir de las distribuciones de sus propios clientes.',
              'Evaluación de referencia: mismo conjunto fijo para ambos modos y todas las repeticiones, generado con semilla propia, disjunto del entrenamiento; coincide con la distribución IID.',
              'Las repeticiones son independientes (semillas derivadas).',
            ]}
          />
        ) : null
      }
      prosCons={{
        benefits: ['FL permite aprovechar datos de poblaciones diversas que nunca se centralizarían.', 'Medir la precisión por cliente revela si el modelo global es justo con todos los participantes.'],
        limitations: [
          'La deriva de clientes puede ralentizar la convergencia o sesgar el modelo global.',
          'Un único modelo global puede funcionar mal para clientes atípicos.',
          'Una sola ejecución puede engañar: hacen falta repeticiones para separar efecto y ruido.',
        ],
      }}
      reflection={{
        question: '¿En qué condiciones de este experimento observaste una diferencia clara entre IID y Non-IID? ¿Cómo distinguirías un efecto real de la variabilidad aleatoria?',
        hint: 'Compara la diferencia de medias con la desviación estándar entre repeticiones y varía las épocas locales.',
      }}
    />
  );
}
