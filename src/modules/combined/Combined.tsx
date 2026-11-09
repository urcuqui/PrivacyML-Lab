import { useMemo } from 'react';
import { Play, Loader2, Building2, Server, Lock, ArrowRight, Plus } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ParamSlider, ParamChoice, ParamToggle, SeedControl, ConfigSection } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps, fmtNum, SERIES } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useSimTask } from '@/lib/useSimTask';
import { useRuns, type ExperimentRun } from '@/lib/runs';
import { validateDataConfig, DEFAULT_DATA_CONFIG, type FederatedDataConfig } from '@/lib/fl/data';
import { numSelected, validateFedConfig, type FedAvgConfig } from '@/lib/fl/fedavg';
import { formatBytes } from '@/lib/fl/communication';
import type { CombinedResult, DpflSweepRow } from '@/lib/tasks';

const EXP_ID = 'combined';
const EXP_TITLE = 'Aprendizaje Federado con Privacidad Diferencial';

interface Params {
  numClients: number;
  samplesPerClient: number;
  nonIid: boolean;
  classImbalance: number;
  featureShift: number;
  rounds: number;
  localEpochs: number;
  localLr: number;
  batchSize: number;
  participationPct: number;
  clipNorm: number;
  noiseMultiplier: number;
  delta: number;
  seed: number;
}

const DEFAULTS: Params = {
  numClients: 5,
  samplesPerClient: 120,
  nonIid: false,
  classImbalance: 0.6,
  featureShift: 1,
  rounds: 15,
  localEpochs: 2,
  localLr: 0.3,
  batchSize: 16,
  participationPct: 100,
  clipNorm: 0.5,
  noiseMultiplier: 1,
  delta: 0.001,
  seed: 42,
};

const SWEEP_SIGMAS = [0, 0.25, 0.5, 1, 2, 4];
const SWEEP_CLIPS = [0.1, 0.5, 2];

function buildConfigs(p: Params): { data: FederatedDataConfig; fed: FedAvgConfig } {
  return {
    data: {
      ...DEFAULT_DATA_CONFIG,
      numClients: p.numClients,
      samplesPerClient: p.samplesPerClient,
      mode: p.nonIid ? 'non-iid' : 'iid',
      classImbalance: p.classImbalance,
      featureShift: p.featureShift,
      seed: p.seed,
    },
    fed: {
      rounds: p.rounds,
      localEpochs: p.localEpochs,
      localLr: p.localLr,
      batchSize: p.batchSize,
      participation: p.participationPct / 100,
      seed: p.seed,
      dp: null,
    },
  };
}

const pct = (v: number) => `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
const num = (v: number, d = 3) => v.toLocaleString('es-ES', { maximumFractionDigits: d });

interface StoredCompare {
  params: Params;
  result: CombinedResult;
}
interface StoredSweep {
  params: Params;
  rows: DpflSweepRow[];
  baselineAcc: number;
}

export default function Combined() {
  const [p, setP, resetP] = usePersistentState<Params>('combined.params', DEFAULTS);
  const [stored, setStored] = usePersistentState<StoredCompare | null>('combined.result', null, false);
  const [sweep, setSweep] = usePersistentState<StoredSweep | null>('combined.sweep', null, false);
  const [showSecAgg, setShowSecAgg] = usePersistentState<boolean>('combined.secagg', false);
  const compareTask = useSimTask('combinedCompare');
  const sweepTask = useSimTask('dpflSweep');
  const { addRun } = useRuns(EXP_ID);
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setP((prev) => ({ ...prev, [k]: v }));

  const { data, fed } = buildConfigs(p);
  const errors = [...validateDataConfig(data), ...validateFedConfig({ ...fed, dp: { clipNorm: p.clipNorm, noiseMultiplier: p.noiseMultiplier } })];
  if (p.batchSize > Math.round(p.samplesPerClient * 0.75)) errors.push('El tamaño de lote no debería superar las muestras de entrenamiento de cada cliente (≈75 % de las muestras).');
  if (!(p.delta > 0 && p.delta < 1)) errors.push('δ debe estar en (0, 1).');
  const m = numSelected(p.numClients, p.participationPct / 100);
  const result = stored?.result ?? null;
  const stale = stored && JSON.stringify(stored.params) !== JSON.stringify(p);
  const sweepStale = sweep && JSON.stringify({ ...sweep.params, clipNorm: 0, noiseMultiplier: 0 }) !== JSON.stringify({ ...p, clipNorm: 0, noiseMultiplier: 0 });

  const run = async () => {
    if (errors.length) return;
    const dp = { clipNorm: p.clipNorm, noiseMultiplier: p.noiseMultiplier, delta: p.delta };
    const r = await compareTask.run({ data, fed, dp });
    if (!r) return;
    setStored({ params: p, result: r });
    const last = r.series[r.series.length - 1];
    const acc = r.dpfed.accounting;
    addRun({
      experimentTitle: EXP_TITLE,
      seed: p.seed,
      params: {
        clientes: p.numClients,
        'muestras/cliente': p.samplesPerClient,
        distribución: p.nonIid ? 'Non-IID' : 'IID',
        rondas: p.rounds,
        'épocas locales': p.localEpochs,
        'tasa de aprendizaje': p.localLr,
        'tamaño de lote': p.batchSize,
        'participación (%)': p.participationPct,
        'C (recorte)': p.clipNorm,
        'σ (ruido)': p.noiseMultiplier,
        δ: p.delta,
      },
      results: {
        'precisión A (centralizado)': last.central,
        'precisión B (FedAvg)': last.fedavg,
        'precisión C (FL+DP)': last.dpfed,
        'bytes B': r.fedavg.bytes,
        'bytes C': r.dpfed.bytes,
        'fracción recortada (C)': r.dpfed.clippedFraction,
        'ε (C)': acc.status === 'computed' ? Number(acc.epsilon.toFixed(3)) : 'No calculado',
      },
      assumptions: [
        'Mismo conjunto de datos sintético, misma partición train/test y misma semilla para A, B y C.',
        'Centralizado: SGD sobre los datos agregados con rondas × épocas locales épocas.',
        'C: unidad de privacidad = cliente; Δ_k recortado a norma C; ruido N(0, σ²C²) añadido a la suma por un servidor de confianza; división por m público.',
        ...(acc.status === 'computed' ? acc.assumptions : []),
      ],
      limitations: [
        'Modelo de regresión logística de 3 parámetros y datos sintéticos 2D.',
        'Aleatoriedad con semilla (no segura). Sin agregación segura implementada.',
        'Coste de comunicación: solo bytes de parámetros float32.',
      ],
      privacyGuarantee:
        acc.status === 'computed'
          ? `(ε = ${acc.epsilon.toFixed(3)}, δ = ${acc.delta})-DP a nivel de cliente para la configuración C, bajo los supuestos indicados (cota RDP conservadora, sin amplificación).`
          : null,
    });
  };

  const runSweep = async () => {
    if (errors.length) return;
    const r = await sweepTask.run({ data, fed, noiseMultipliers: SWEEP_SIGMAS, clipNorms: SWEEP_CLIPS, repeats: 3, delta: p.delta });
    if (r) setSweep({ params: p, rows: r.rows, baselineAcc: r.baselineAcc });
  };

  const restore = (r: ExperimentRun) => {
    const g = (k: string) => r.params[k];
    setP({
      ...p,
      numClients: Number(g('clientes') ?? p.numClients),
      samplesPerClient: Number(g('muestras/cliente') ?? p.samplesPerClient),
      nonIid: g('distribución') === 'Non-IID',
      rounds: Number(g('rondas') ?? p.rounds),
      localEpochs: Number(g('épocas locales') ?? p.localEpochs),
      localLr: Number(g('tasa de aprendizaje') ?? p.localLr),
      batchSize: Number(g('tamaño de lote') ?? p.batchSize),
      participationPct: Number(g('participación (%)') ?? p.participationPct),
      clipNorm: Number(g('C (recorte)') ?? p.clipNorm),
      noiseMultiplier: Number(g('σ (ruido)') ?? p.noiseMultiplier),
      delta: Number(g('δ') ?? p.delta),
      seed: r.seed ?? p.seed,
    });
  };

  const sweepChart = useMemo(() => {
    if (!sweep) return [];
    return SWEEP_SIGMAS.map((s) => {
      const row: Record<string, number> = { sigma: s };
      for (const c of SWEEP_CLIPS) {
        const r = sweep.rows.find((x) => x.noiseMultiplier === s && x.clipNorm === c);
        if (r) row[`C=${c}`] = r.accMean;
      }
      return row;
    });
  }, [sweep]);

  const usedParams = stored?.params ?? p;
  const usedM = numSelected(usedParams.numClients, usedParams.participationPct / 100);
  const acc = result?.dpfed.accounting;
  const last = result ? result.series[result.series.length - 1] : null;

  const config = (
    <>
      <ConfigSection title="Datos (escenario de hospitales)">
        <ParamSlider label={<>Número de clientes (hospitales)</>} ariaLabel="Número de clientes" value={p.numClients} onChange={set('numClients')} min={2} max={10} step={1} />
        <ParamSlider label="Muestras por cliente" ariaLabel="Muestras por cliente" value={p.samplesPerClient} onChange={set('samplesPerClient')} min={20} max={600} step={10} />
        <ParamToggle label={<><Term k="nonIid">Datos Non-IID</Term></>} checked={p.nonIid} onChange={set('nonIid')} help="Desequilibrio de clases y desplazamiento de características entre hospitales." />
        {p.nonIid && (
          <>
            <ParamSlider label="Desequilibrio de clases" ariaLabel="Desequilibrio de clases" value={p.classImbalance} onChange={set('classImbalance')} min={0} max={1} step={0.05} />
            <ParamSlider label="Desplazamiento de características" ariaLabel="Desplazamiento de características" value={p.featureShift} onChange={set('featureShift')} min={0} max={3} step={0.1} />
          </>
        )}
      </ConfigSection>
      <ConfigSection title="Entrenamiento federado">
        <ParamSlider label={<Term k="round">Rondas</Term>} ariaLabel="Rondas de comunicación" value={p.rounds} onChange={set('rounds')} min={1} max={60} step={1} />
        <ParamSlider label={<Term k="localEpochs">Épocas locales</Term>} ariaLabel="Épocas locales" value={p.localEpochs} onChange={set('localEpochs')} min={1} max={10} step={1} />
        <ParamSlider label={<Term k="learningRate">Tasa de aprendizaje</Term>} ariaLabel="Tasa de aprendizaje" value={p.localLr} onChange={set('localLr')} min={0.01} max={2} step={0.01} />
        <ParamSlider label={<Term k="batchSize">Tamaño de lote</Term>} ariaLabel="Tamaño de lote" value={p.batchSize} onChange={set('batchSize')} min={1} max={128} step={1} />
        <ParamSlider
          label={<Term k="participation">Participación de clientes</Term>}
          ariaLabel="Participación de clientes"
          value={p.participationPct}
          onChange={set('participationPct')}
          min={10}
          max={100}
          step={5}
          unit="%"
          help={`${m} de ${p.numClients} clientes por ronda. Con < 100 % el ε se muestra como «No calculado».`}
        />
      </ConfigSection>
      <ConfigSection title="Privacidad diferencial (configuración C)">
        <ParamSlider label={<Term k="clipping">Norma de recorte C</Term>} ariaLabel="Norma de recorte" value={p.clipNorm} onChange={set('clipNorm')} min={0.01} max={5} step={0.01} log />
        <ParamSlider label={<Term k="noiseMultiplier">Multiplicador de ruido σ</Term>} ariaLabel="Multiplicador de ruido" value={p.noiseMultiplier} onChange={set('noiseMultiplier')} min={0} max={8} step={0.05} />
        <ParamChoice label={<Term k="delta">δ</Term>} value={p.delta} options={[0.01, 0.001, 0.0001, 0.00001] as const} onChange={set('delta')} format={(v) => v.toExponential(0)} help={`Debe ser mucho menor que 1/(nº de clientes) = ${num(1 / p.numClients)}.`} />
      </ConfigSection>
      <ConfigSection title="Reproducibilidad">
        <SeedControl value={p.seed} onChange={set('seed')} />
      </ConfigSection>
      <ErrorList errors={errors} />
      <Button className="w-full" onClick={run} disabled={!!errors.length || compareTask.running}>
        {compareTask.running ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar A, B y C
      </Button>
      {compareTask.error && <Callout kind="danger">{compareTask.error}</Callout>}
    </>
  );

  const visual = (
    <>
      <VisualCard title="Tres configuraciones, mismas condiciones" description="Mismos datos sintéticos, misma partición de test global y misma semilla." actions={<IntegrityBadge kind="sim" />}>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { k: 'A', t: 'Centralizado', d: 'Los hospitales envían sus registros a un servidor que entrena el modelo.', c: SERIES[0] },
            { k: 'B', t: 'Aprendizaje Federado', d: 'Los datos se quedan en cada hospital; se envían modelos locales y se agregan con FedAvg.', c: SERIES[1] },
            { k: 'C', t: 'FL + DP', d: 'Cada actualización Δ_k se recorta a norma C; el servidor añade ruido gaussiano a la suma.', c: SERIES[2] },
          ].map((x) => (
            <div key={x.k} className="rounded-md border p-3" style={{ borderTopColor: x.c, borderTopWidth: 3 }}>
              <p className="text-sm font-semibold">
                {x.k} — {x.t}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.d}</p>
            </div>
          ))}
        </div>
        {stale && <Callout kind="warn" className="mt-3">Los parámetros han cambiado desde la última ejecución. Pulsa «Ejecutar A, B y C» para actualizar los resultados.</Callout>}
      </VisualCard>

      {result ? (
        <>
          <VisualCard title="Precisión en el conjunto de test global por ronda" actions={<IntegrityBadge kind="real" />}>
            <ChartFrame
              title="Precisión de test por ronda"
              description="Para A, cada «ronda» equivale a tantas épocas centralizadas como épocas locales. Valores calculados en esta ejecución."
              data={result.series}
              columns={[
                { key: 'round', label: 'Ronda' },
                { key: 'central', label: 'A centralizado', format: (v) => pct(v as number) },
                { key: 'fedavg', label: 'B FedAvg', format: (v) => pct(v as number) },
                { key: 'dpfed', label: 'C FL+DP', format: (v) => pct(v as number) },
              ]}
            >
              <LineChart data={result.series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="round" {...axisProps} label={{ value: 'Ronda', position: 'insideBottomRight', offset: -2, fill: C.axis, fontSize: 11 }} />
                <YAxis {...axisProps} domain={[0.3, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Tooltip {...tooltipProps} formatter={(v: number) => pct(v)} />
                <Legend {...legendProps} />
                <Line type="monotone" dataKey="central" name="A — Centralizado" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="fedavg" name="B — FedAvg" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="dpfed" name="C — FL + DP" stroke={SERIES[2]} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartFrame>
          </VisualCard>
          <VisualCard title="Pérdida de entrenamiento (entropía cruzada) por ronda" actions={<IntegrityBadge kind="real" />}>
            <ChartFrame
              title="Pérdida de entrenamiento"
              description="Pérdida global ponderada por n_k, evaluada con el modelo global de cada configuración."
              height={220}
              data={result.series}
              columns={[
                { key: 'round', label: 'Ronda' },
                { key: 'centralLoss', label: 'A' },
                { key: 'fedavgLoss', label: 'B' },
                { key: 'dpfedLoss', label: 'C' },
              ]}
            >
              <LineChart data={result.series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="round" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtNum(2)} />
                <Tooltip {...tooltipProps} formatter={fmtNum(4)} />
                <Legend {...legendProps} />
                <Line type="monotone" dataKey="centralLoss" name="A — Centralizado" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="fedavgLoss" name="B — FedAvg" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="dpfedLoss" name="C — FL + DP" stroke={SERIES[2]} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartFrame>
          </VisualCard>
          <VisualCard title="Comparación de configuraciones" description="Métricas calculadas en la última ejecución; filas cualitativas indicadas como tales.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <caption className="sr-only">Comparación entre centralizado, FedAvg y FL con DP</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-1.5 pr-2 text-left font-medium text-muted-foreground">Aspecto</th>
                    <th scope="col" className="px-2 py-1.5 text-left">A — Centralizado</th>
                    <th scope="col" className="px-2 py-1.5 text-left">B — FedAvg</th>
                    <th scope="col" className="px-2 py-1.5 text-left">C — FL + DP</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:py-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:align-top [&_th]:font-normal [&_tr]:border-b">
                  <tr>
                    <th scope="row">Precisión final (test global)</th>
                    <td className="num">{pct(result.central.finalAcc)}</td>
                    <td className="num">{pct(result.fedavg.finalAcc)}</td>
                    <td className="num">{pct(result.dpfed.finalAcc)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Pérdida de entrenamiento final</th>
                    <td className="num">{num(last!.centralLoss, 4)}</td>
                    <td className="num">{num(last!.fedavgLoss, 4)}</td>
                    <td className="num">{num(last!.dpfedLoss, 4)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Comunicación (modelo simplificado)</th>
                    <td className="num">{formatBytes(result.central.rawDataBytes)} <span className="font-sans text-muted-foreground">de datos brutos, una vez</span></td>
                    <td className="num">{formatBytes(result.fedavg.bytes)} <span className="font-sans text-muted-foreground">de parámetros</span></td>
                    <td className="num">{formatBytes(result.dpfed.bytes)} <span className="font-sans text-muted-foreground">(igual que B)</span></td>
                  </tr>
                  <tr>
                    <th scope="row">Cómputo (evaluaciones de gradiente)</th>
                    <td className="num">{result.central.gradEvals.toLocaleString('es-ES')}</td>
                    <td className="num">{result.fedavg.gradEvals.toLocaleString('es-ES')}</td>
                    <td className="num">
                      {result.dpfed.gradEvals.toLocaleString('es-ES')}
                      <span className="block font-sans text-muted-foreground">+ recorte de {usedM} Δ y ruido de 3 coordenadas por ronda</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Exposición de datos brutos <span className="text-muted-foreground">(cualitativo)</span></th>
                    <td>Todos los registros salen de cada hospital hacia el servidor.</td>
                    <td>No salen registros; se envían modelos locales completos.</td>
                    <td>No salen registros; se envían Δ_k (recortados en el servidor de confianza).</td>
                  </tr>
                  <tr>
                    <th scope="row">Información en las actualizaciones</th>
                    <td className="text-muted-foreground">No aplica (el servidor ve los datos).</td>
                    <td>‖Δ_k‖ medio = <span className="num">{num(result.fedavg.meanUpdateNorm)}</span>, sin límite: cada Δ_k depende sin cota de los datos del cliente.</td>
                    <td>
                      ‖Δ_k‖ medio antes de recortar = <span className="num">{num(result.dpfed.meanUpdateNorm)}</span>; recortadas: <span className="num">{pct(result.dpfed.clippedFraction)}</span>; ruido en el modelo: σC/m = <span className="num">{num(result.dpfed.noiseStdPerCoord, 4)}</span> por coordenada.
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Supuestos de privacidad</th>
                    <td>Confianza total en el servidor central y en su seguridad.</td>
                    <td>Sin garantía formal. Un servidor curioso ve cada actualización individual.</td>
                    <td>
                      {acc?.status === 'computed' ? (
                        <>
                          <IntegrityBadge kind="formal" /> <span className="num">(ε = {num(acc.epsilon)}, δ = {acc.delta})</span> a nivel de cliente; servidor de confianza.
                        </>
                      ) : (
                        <>
                          <IntegrityBadge kind="not-computed" /> {acc?.status === 'not-computed' ? acc.reason : ''}
                        </>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </VisualCard>
        </>
      ) : (
        <Callout>Configura el escenario y pulsa «Ejecutar A, B y C». Todas las curvas y métricas se calculan en tu navegador (en un Web Worker).</Callout>
      )}

      <VisualCard
        title="Compromiso privacidad–utilidad"
        description={`Precisión final media de C (3 repeticiones de entrenamiento) al variar σ, para varias normas de recorte C. Barrido sobre σ ∈ {${SWEEP_SIGMAS.join(', ')}}.`}
        actions={
          <>
            <IntegrityBadge kind="empirical" />
            <Button size="sm" variant="outline" onClick={runSweep} disabled={!!errors.length || sweepTask.running}>
              {sweepTask.running ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar barrido
            </Button>
          </>
        }
      >
        {sweepTask.error && <Callout kind="danger">{sweepTask.error}</Callout>}
        {sweep ? (
          <>
            {sweepStale && <Callout kind="warn" className="mb-3">El barrido se calculó con otros parámetros de datos/entrenamiento. Vuelve a ejecutarlo para actualizarlo.</Callout>}
            <ChartFrame
              title="Precisión de test frente a multiplicador de ruido σ"
              description={`Línea discontinua: FedAvg sin DP (${pct(sweep.baselineAcc)}). ε solo aparece en la tabla cuando es calculable (participación 100 % y σ > 0).`}
              data={sweep.rows}
              columns={[
                { key: 'noiseMultiplier', label: 'σ' },
                { key: 'clipNorm', label: 'C' },
                { key: 'accMean', label: 'Precisión media', format: (v) => pct(v as number) },
                { key: 'accStd', label: 'Desv. típica', format: (v) => pct(v as number) },
                { key: 'epsilon', label: `ε (δ=${sweep.params.delta})`, format: (v) => (typeof v === 'number' ? num(v) : 'No calculado') },
              ]}
            >
              <LineChart data={sweepChart} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="sigma" type="category" {...axisProps} label={{ value: 'σ', position: 'insideBottomRight', offset: -2, fill: C.axis, fontSize: 11 }} />
                <YAxis {...axisProps} domain={[0.3, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Tooltip {...tooltipProps} formatter={(v: number) => pct(v)} labelFormatter={(l) => `σ = ${l}`} />
                <Legend {...legendProps} />
                <ReferenceLine y={sweep.baselineAcc} stroke={C.muted} strokeDasharray="4 4" label={{ value: 'FedAvg sin DP', fill: C.muted, fontSize: 10, position: 'insideBottomLeft' }} />
                {SWEEP_CLIPS.map((c, i) => (
                  <Line key={c} type="monotone" dataKey={`C=${c}`} name={`C = ${c}`} stroke={SERIES[(i + 2) % SERIES.length]} strokeWidth={2} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartFrame>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Ejecuta el barrido para ver cómo cambia la precisión al aumentar el ruido. Usa los parámetros de datos y entrenamiento actuales.</p>
        )}
        <div className="mt-3 grid gap-2 text-[13px] leading-relaxed md:grid-cols-2">
          <p>
            <strong>Más ruido (σ ↑):</strong> la desviación del ruido es σC/m por coordenada. Enmascara mejor la contribución de cualquier cliente (cada Δ_k pesa como mucho C/m), pero también la señal útil común: el modelo
            se mueve de forma más aleatoria y la precisión baja o se vuelve inestable.
          </p>
          <p>
            <strong>Recorte C:</strong> un C pequeño recorta casi todas las actualizaciones y sesga la dirección del aprendizaje (sesgo), pero el ruido absoluto σC es menor. Un C grande no recorta (sin sesgo) pero exige más ruido
            absoluto para la misma σ (más varianza). El mejor C depende de la norma típica de Δ_k.
          </p>
        </div>
      </VisualCard>

      <VisualCard
        title="D — FL + DP + Agregación segura (modo conceptual opcional)"
        actions={
          <>
            <IntegrityBadge kind="concept" />
            <ParamToggle label="Mostrar" checked={showSecAgg} onChange={setShowSecAgg} />
          </>
        }
      >
        {showSecAgg ? <SecAggDiagram /> : <p className="text-sm text-muted-foreground">Activa «Mostrar» para ver dónde encajaría la agregación segura. No se implementa ningún protocolo criptográfico.</p>}
      </VisualCard>
    </>
  );

  const observations = result ? (
    <>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="A" value={pct(result.central.finalAcc)} sub="centralizado" />
        <StatTile label="B" value={pct(result.fedavg.finalAcc)} sub="FedAvg" tone="fl" />
        <StatTile label="C" value={pct(result.dpfed.finalAcc)} sub="FL + DP" tone="dp" />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold">Garantía de privacidad de C</p>
        {acc?.status === 'computed' ? (
          <>
            <IntegrityBadge kind="formal" />
            <p className="num text-lg font-semibold text-dp">
              ε = {num(acc.epsilon)}, δ = {acc.delta}
            </p>
            <p className="text-xs text-muted-foreground">Nivel de cliente, {usedParams.rounds} rondas, σ = {usedParams.noiseMultiplier}. Cota RDP conservadora. Supuestos:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug">
              {acc.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <IntegrityBadge kind="not-computed" />
            <p className="text-xs leading-relaxed">{acc?.status === 'not-computed' ? acc.reason : ''}</p>
          </>
        )}
      </div>
      <Callout kind="info" title="Qué observar">
        Compara la distancia entre B y C: ese es el «coste en utilidad» de la DP con esta configuración. Fíjate en que la comunicación de B y C es idéntica: la DP aquí no añade bytes, añade ruido y recorte.
      </Callout>
      <Callout kind="warn" title="Cuidado al interpretar">
        Que C tenga una precisión similar a B no significa que la privacidad sea «gratis»: con pocos clientes, el ruido σC/m es grande frente a la señal, y con σ pequeña ε crece. Un ε grande ofrece poca protección.
      </Callout>
      <p className="text-[11px] text-muted-foreground">Con solo {usedParams.numClients} clientes, la DP a nivel de cliente es muy difícil: cada cliente es una fracción enorme de los datos. En la práctica se usa con miles de clientes.</p>
    </>
  ) : (
    <p className="text-sm text-muted-foreground">Las observaciones aparecerán tras la primera ejecución.</p>
  );

  const details = result ? (
    <ShowCalculations
      equations={[
        'Δ_k = w_k − w_t                                  (actualización local del cliente k)',
        'Δ̃_k = Δ_k · min(1, C / ‖Δ_k‖₂)                    (recorte: ‖Δ̃_k‖ ≤ C ⇒ sensibilidad L2 de la suma = C)',
        'w_{t+1} = w_t + ( Σ_k Δ̃_k + N(0, σ²C² I) ) / m      (ruido añadido por el servidor de confianza; m público)',
        'B (FedAvg): w_{t+1} = Σ_k (n_k / N) · w_k',
        'ε(δ) = min_α [ T·α / (2σ²) + ln(1/δ) / (α − 1) ]   (solo con participación 100 %)',
      ]}
      inputs={[
        { label: 'Unidad de privacidad', value: 'cliente (todos sus registros)' },
        { label: 'C (norma de recorte)', value: usedParams.clipNorm },
        { label: 'σ (multiplicador de ruido)', value: usedParams.noiseMultiplier },
        { label: 'm (clientes por ronda)', value: usedM },
        { label: 'T (rondas)', value: usedParams.rounds },
        { label: 'δ', value: usedParams.delta },
        { label: 'Tamaños n_k de los clientes', value: result.clientSizes.join(', ') },
      ]}
      intermediates={[
        { label: 'Desv. del ruido sobre la suma σC', value: num(usedParams.noiseMultiplier * usedParams.clipNorm, 4) },
        { label: 'Desv. del ruido en el modelo σC/m', value: num(result.dpfed.noiseStdPerCoord, 4) },
        { label: 'Influencia máx. de un cliente C/m', value: num(usedParams.clipNorm / usedM, 4) },
        { label: '‖Δ_k‖ medio (C, antes de recortar)', value: num(result.dpfed.meanUpdateNorm, 4) },
        { label: 'Fracción de Δ_k recortadas', value: pct(result.dpfed.clippedFraction) },
        { label: 'Épocas centralizadas (A)', value: result.central.epochs },
      ]}
      outputs={[
        { label: 'Precisión A / B / C', value: `${pct(result.central.finalAcc)} / ${pct(result.fedavg.finalAcc)} / ${pct(result.dpfed.finalAcc)}` },
        { label: 'θ final B', value: result.fedavg.finalParams.map((v) => num(v)).join(', ') },
        { label: 'θ final C', value: result.dpfed.finalParams.map((v) => num(v)).join(', ') },
        { label: 'ε', value: acc?.status === 'computed' ? `${num(acc.epsilon)} (α* = ${num(acc.optimalAlpha, 2)})` : 'No calculado' },
      ]}
      assumptions={[
        'DP central: un servidor de confianza ve las Δ_k individuales y añade el ruido. Sin agregación segura, un servidor curioso podría verlas antes del ruido.',
        'La media de C NO se pondera por n_k (los pesos dependerían de los datos y aumentarían la sensibilidad).',
        'El ruido usa un PRNG con semilla: válido para reproducibilidad, no para un despliegue real.',
        'El centralizado usa rondas × épocas locales épocas de SGD con la misma tasa y tamaño de lote.',
        'Los hiperparámetros elegidos mirando la precisión de test también consumirían privacidad en un sistema real (aquí no se contabiliza).',
      ]}
    />
  ) : null;

  return (
    <ExperimentLayout
      experimentId={EXP_ID}
      module="combined"
      kicker="Módulo 3 — Experimento combinado"
      title={EXP_TITLE}
      objective="Comparar en condiciones equivalentes el entrenamiento centralizado, el federado y el federado con privacidad diferencial a nivel de cliente, y cuantificar el compromiso entre privacidad, utilidad y coste."
      badges={['real', 'sim', 'formal', 'concept']}
      intro={
        <>
          <p>
            Volvemos a los hospitales del Módulo 2. En el Módulo 2 vimos que FedAvg evita mover registros, pero que las actualizaciones de modelo todavía dependen de los datos de cada hospital y pueden revelar información.
            ¿Podemos limitar formalmente cuánto influye un hospital concreto en el modelo publicado?
          </p>
          <p>
            La idea de la configuración C es la misma que en DP-SGD, pero cambiando la <Term k="privacyUnit">unidad de privacidad</Term>: en lugar de un registro, protegemos a un <strong>cliente completo</strong>. Cada
            hospital envía su actualización Δ_k; el servidor la <Term k="clipping">recorta</Term> a norma C (así ningún hospital puede mover el modelo más de C/m), suma las actualizaciones y añade{' '}
            <Term k="gaussian">ruido gaussiano</Term> N(0, σ²C²). Con participación total, el <Term k="accountant">contador</Term> RDP da una cota (ε, δ) a nivel de cliente.
          </p>
          <p>
            Compararemos precisión, pérdida, comunicación, cómputo y, sobre todo, <em>qué supuestos</em> necesita cada configuración para afirmar algo sobre la privacidad.
          </p>
        </>
      }
      config={config}
      visual={visual}
      observations={observations}
      timeline={<RunTimeline experimentId={EXP_ID} onRestore={restore} onReset={resetP} />}
      details={details}
      prosCons={{
        benefits: [
          'Combinar FL y DP evita mover datos brutos y además acota la influencia de cada cliente en el modelo publicado.',
          'Con participación total y σ > 0 se obtiene una garantía (ε, δ) formal a nivel de cliente, bajo supuestos explícitos.',
          'El coste de comunicación no aumenta respecto a FedAvg: el recorte y el ruido son baratos.',
        ],
        limitations: [
          'El ruido reduce la utilidad, sobre todo con pocos clientes: la DP a nivel de cliente necesita muchos participantes.',
          'La DP central requiere confiar en el servidor que añade el ruido; sin agregación segura ve cada actualización.',
          'Elegir C y σ es delicado (sesgo por recorte frente a varianza por ruido) y el ajuste con datos privados también consume privacidad.',
          'La cota calculada es conservadora (sin amplificación por muestreo) y solo aplica con participación total.',
        ],
      }}
      reflection={{
        question:
          'Una red de 5 hospitales quiere un modelo con ε ≤ 3 a nivel de hospital. Según tus experimentos, ¿es realista mantener una precisión cercana a FedAvg? ¿Qué cambiarías en el sistema (número de clientes, rondas, σ, C, agregación segura) y por qué?',
        hint: 'Observa cómo crece ε con las rondas y decrece con σ, y cómo el ruido en el modelo es σC/m: más clientes (m mayor) diluyen el ruido para la misma garantía.',
      }}
    />
  );
}

function SecAggDiagram() {
  const box = 'rounded-md border bg-card p-2 text-center text-xs';
  return (
    <div className="space-y-3">
      <div className="grid items-center gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="space-y-1.5">
          {[1, 2, 3].map((k) => (
            <div key={k} className={box}>
              <Building2 className="mx-auto mb-1 h-4 w-4 text-fl" aria-hidden />
              Hospital {k}: Δ̃_{k} recortado
              <span className="mt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                <Plus className="h-3 w-3" aria-hidden /> ruido parcial + máscara aleatoria
              </span>
            </div>
          ))}
        </div>
        <ArrowRight className="mx-auto h-5 w-5 rotate-90 text-muted-foreground md:rotate-0" aria-hidden />
        <div className={`${box} border-dashed border-primary`}>
          <Lock className="mx-auto mb-1 h-5 w-5 text-primary" aria-hidden />
          <p className="font-semibold">Agregación segura</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Las máscaras se cancelan al sumar: solo se revela Σ_k (Δ̃_k + ruido_k)</p>
        </div>
        <ArrowRight className="mx-auto h-5 w-5 rotate-90 text-muted-foreground md:rotate-0" aria-hidden />
        <div className={box}>
          <Server className="mx-auto mb-1 h-4 w-4 text-muted-foreground" aria-hidden />
          Servidor: ve solo la suma ruidosa y actualiza w
        </div>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
        <li>
          <strong>Qué protege:</strong> el servidor ya no ve cada Δ_k individual, solo la suma. Si cada cliente añade una parte del ruido (ruido distribuido), ningún actor necesita ser de confianza para añadirlo.
        </li>
        <li>
          <strong>Qué no protege:</strong> lo que revela la suma y el modelo final (para eso está la DP); clientes que abandonan a mitad de protocolo o se confabulan; clientes maliciosos que envían actualizaciones envenenadas.
        </li>
        <li>
          <strong>Ruido distribuido:</strong> si cada uno de m clientes añade N(0, σ²C²/m), la suma tiene ruido N(0, σ²C²), pero solo si todos son honestos; si algunos omiten su parte, la garantía se debilita.
        </li>
      </ul>
      <Callout kind="warn">Esto es una ilustración conceptual. El laboratorio no implementa máscaras por pares, intercambio de claves ni gestión de abandonos: los resultados de la configuración C asumen un servidor de confianza.</Callout>
    </div>
  );
}
