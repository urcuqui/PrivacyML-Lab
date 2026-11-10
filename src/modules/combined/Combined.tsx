import { useMemo, type ReactNode } from 'react';
import { Play, Loader2, Building2, Server, Lock, ArrowRight, Plus, Eye, Globe } from 'lucide-react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ParamSlider, ParamChoice, ParamToggle, SeedControl, ConfigSection } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { AdjacencyChoice, ContextualCheck, PrivacyModelCard } from '@/components/lab/PrivacyModel';
import { Term } from '@/components/lab/Term';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, axisProps, gridProps, legendProps, tooltipProps, fmtNum, SERIES } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useSimTask } from '@/lib/useSimTask';
import { privacyRecord, useRuns, type ExperimentRun } from '@/lib/runs';
import { validateDataConfig, DEFAULT_DATA_CONFIG, type FederatedDataConfig } from '@/lib/fl/data';
import { dpFedAccounting, numSelected, validateFedConfig, type FedAvgConfig } from '@/lib/fl/fedavg';
import { formatBytes } from '@/lib/fl/communication';
import { ADJACENCY_INFO, clippedSumSensitivityMultiple, dpFedAvgSpec, type Adjacency } from '@/lib/privacy/model';
import type { CombinedResult, DpflSweepRow } from '@/lib/tasks';

const EXP_ID = 'combined';
const EXP_TITLE = 'Aprendizaje Federado con Privacidad Diferencial';

interface Params {
  numClients: number;
  samplesPerClient: number;
  sizeSkew: number;
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
  adjacency: Adjacency;
  noiseRepeats: number;
  seed: number;
}

const DEFAULTS: Params = {
  numClients: 5,
  samplesPerClient: 120,
  sizeSkew: 0.5,
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
  adjacency: 'add-remove',
  noiseRepeats: 5,
  seed: 42,
};

const SWEEP_SIGMAS = [0, 0.25, 0.5, 1, 2, 4];
const SWEEP_CLIPS = [0.1, 0.5, 2];
const SWEEP_REPEATS = 3;

/** Identidad visual de cada configuración. */
const CFG = {
  A: { key: 'central', label: 'A — Centralizado', color: SERIES[0] },
  B1: { key: 'fedavg', label: 'B1 — FedAvg ponderado', color: SERIES[1] },
  B2: { key: 'uniform', label: 'B2 — FedAvg uniforme', color: SERIES[3] },
  C: { key: 'clipped', label: 'C — Uniforme + recorte (no DP)', color: SERIES[4] },
  D: { key: 'dpfed', label: 'D — DP-FedAvg', color: SERIES[2] },
} as const;

function buildConfigs(p: Params): { data: FederatedDataConfig; fed: FedAvgConfig } {
  return {
    data: {
      ...DEFAULT_DATA_CONFIG,
      numClients: p.numClients,
      samplesPerClient: p.samplesPerClient,
      sizeSkew: p.sizeSkew,
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
/** Diferencia en puntos porcentuales con signo. */
const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} p.p.`;
const num = (v: number, d = 3) => v.toLocaleString('es-ES', { maximumFractionDigits: d });
const fmtDelta = (d: number) => (d < 1e-3 ? Number(d.toPrecision(3)).toExponential() : String(d));

interface StoredCompare {
  params: Params;
  result: CombinedResult;
}
interface StoredSweep {
  params: Params;
  rows: DpflSweepRow[];
  baselineAcc: number;
  uniformAcc: number;
}

/** Explicación contextual construida a partir de la descomposición real. */
function decompositionExplanation(r: CombinedResult, p: Params): ReactNode {
  const d = r.decomposition;
  const R = r.noiseRepeats;
  const se = R > 1 ? d.noiseStd / Math.sqrt(R) : NaN;
  const tiny = 0.0005;
  const clipFrac = r.clipped.clippedFraction;
  const terms = [
    { name: 'la ponderación', v: d.weighting, distinguishable: Math.abs(d.weighting) >= tiny },
    { name: 'el recorte', v: d.clipping, distinguishable: Math.abs(d.clipping) >= tiny },
    { name: 'el ruido', v: d.noise, distinguishable: R > 1 ? Math.abs(d.noise) >= 2 * se : false },
  ];
  const main = terms.filter((t) => t.distinguishable).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
  return (
    <>
      <p>
        En tu última ejecución la diferencia total entre B1 (FedAvg ponderado) y D (DP-FedAvg) es <strong className="num">{pp(d.total)}</strong>, que se reparte así (descomposición secuencial empírica):
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Ponderación</strong> (B1 → B2): <span className="num">{pp(d.weighting)}</span>.{' '}
          {Math.abs(d.weighting) < tiny
            ? p.sizeSkew === 0
              ? 'Es prácticamente cero porque todos los hospitales tienen el mismo número de muestras: ponderar por n_k/N o uniformemente da los mismos pesos. Sube la asimetría de tamaños para verlo.'
              : 'Es prácticamente nulo en esta ejecución: con estos datos, cambiar los pesos apenas mueve el modelo final.'
            : 'Cambiar de pesos n_k/N a 1/m̄ da más voz a los hospitales pequeños; no tiene nada que ver con la privacidad, pero DP-FedAvg lo necesita para acotar la sensibilidad.'}
        </li>
        <li>
          <strong>Recorte</strong> (B2 → C): <span className="num">{pp(d.clipping)}</span>. Se recortó el <span className="num">{pct(clipFrac)}</span> de las actualizaciones con C = {p.clipNorm}.{' '}
          {clipFrac === 0
            ? 'Como ninguna actualización superó C, el recorte no cambia nada: su efecto es exactamente cero.'
            : clipFrac > 0.8
              ? 'Casi todas se recortan: el recorte acorta los pasos (y puede sesgar la dirección) aunque no haya ruido.'
              : 'Solo afecta a las actualizaciones más grandes.'}
        </li>
        <li>
          <strong>Ruido</strong> (C → D): <span className="num">{pp(d.noise)}</span>
          {R > 1 ? (
            <>
              {' '}
              (media de {R} semillas de ruido; desv. típica <span className="num">{num(d.noiseStd * 100, 2)} p.p.</span>, error típico de la media <span className="num">{num(se * 100, 2)} p.p.</span>).{' '}
              {Math.abs(d.noise) < 2 * se
                ? 'Este efecto medio NO se distingue de la variabilidad del propio ruido (|efecto| < 2 errores típicos).'
                : 'El efecto medio es mayor que dos errores típicos: es atribuible al ruido con estos datos y esta semilla.'}
            </>
          ) : (
            ' (con una sola repetición no se puede estimar la variabilidad del ruido; sube «Repeticiones del ruido»).'
          )}
        </li>
      </ul>
      <p>
        {main
          ? `Con esta configuración, el término de mayor magnitud que se distingue de la variabilidad es ${main.name}.`
          : 'Ningún término se distingue claramente de cero o de la variabilidad en esta ejecución.'}{' '}
        Es una observación de este experimento controlado (mismos datos, misma selección de clientes y mismo entrenamiento local), no una ley general: con otros datos u otro orden de las transformaciones el reparto podría ser
        distinto si los efectos interactúan.
      </p>
    </>
  );
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
  const dpCfg = { clipNorm: p.clipNorm, noiseMultiplier: p.noiseMultiplier, delta: p.delta, adjacency: p.adjacency };
  const errors = [...validateDataConfig(data), ...validateFedConfig({ ...fed, dp: dpCfg })];
  if (!(p.delta > 0 && p.delta < 1)) errors.push('δ debe estar en (0, 1).');
  if (!Number.isInteger(p.noiseRepeats) || p.noiseRepeats < 1 || p.noiseRepeats > 20) errors.push('Las repeticiones del ruido deben estar entre 1 y 20.');
  const m = numSelected(p.numClients, p.participationPct / 100);
  /** Contabilidad para la configuración ACTUAL (barata: no requiere entrenar). */
  const liveAccounting = useMemo(() => {
    try {
      return dpFedAccounting({ ...fed, dp: dpCfg }, p.numClients);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rounds, p.participationPct, p.numClients, p.noiseMultiplier, p.clipNorm, p.delta, p.adjacency]);
  const result = stored?.result ?? null;
  const stale = stored && JSON.stringify(stored.params) !== JSON.stringify(p);
  const neutral = (x: Params) => JSON.stringify({ ...x, clipNorm: 0, noiseMultiplier: 0, noiseRepeats: 0 });
  const sweepStale = sweep && neutral(sweep.params) !== neutral(p);

  const run = async () => {
    if (errors.length) return;
    const r = await compareTask.run({ data, fed, dp: dpCfg, noiseRepeats: p.noiseRepeats });
    if (!r) return;
    setStored({ params: p, result: r });
    const acc = r.dpfed.accounting;
    const d = r.decomposition;
    addRun({
      experimentTitle: EXP_TITLE,
      seed: p.seed,
      params: {
        rondas: p.rounds,
        'épocas locales': p.localEpochs,
        'tasa de aprendizaje': p.localLr,
        'tamaño de lote': p.batchSize,
        'participación (%)': p.participationPct,
        'C (recorte)': p.clipNorm,
        'σ (ruido)': p.noiseMultiplier,
        δ: p.delta,
        vecindad: ADJACENCY_INFO[p.adjacency].label,
        'repeticiones del ruido': p.noiseRepeats,
      },
      dataConfig: {
        clientes: p.numClients,
        'muestras/cliente': p.samplesPerClient,
        'asimetría de tamaños': p.sizeSkew,
        distribución: p.nonIid ? 'Non-IID' : 'IID',
        'desequilibrio de clases': p.nonIid ? p.classImbalance : null,
        'desplazamiento de características': p.nonIid ? p.featureShift : null,
        'tamaños n_k': r.clientSizes.join(', '),
      },
      results: {
        'precisión A (centralizado)': r.central.finalAcc,
        'precisión B1 (FedAvg ponderado)': r.fedavg.finalAcc,
        'precisión B2 (FedAvg uniforme)': r.uniform.finalAcc,
        'precisión C (recorte, sin ruido)': r.clipped.finalAcc,
        'precisión D (DP-FedAvg, media)': r.dpfed.finalAcc,
        'desv. típica D (ruido)': r.dpfed.finalAccStd,
        'efecto ponderación (B2 − B1)': d.weighting,
        'efecto recorte (C − B2)': d.clipping,
        'efecto ruido (D − C)': d.noise,
        'bytes por configuración FL': r.fedavg.bytes,
        'fracción recortada (D)': r.dpfed.clippedFraction,
        'ε (D)': acc.status === 'computed' ? Number(acc.epsilon.toFixed(3)) : 'No calculado',
      },
      assumptions: [
        'Mismo conjunto de datos sintético, misma partición train/test, misma selección de clientes y mismo entrenamiento local para B1, B2, C y D.',
        'D se repite con R semillas de ruido distintas; solo cambia el ruido.',
        'La descomposición B1 → B2 → C → D es secuencial y empírica: con efectos que interactúan, otro orden podría repartir la diferencia de otra manera.',
        'Centralizado: SGD sobre los datos agregados con rondas × épocas locales épocas.',
        `D: unidad = cliente; Δ_k recortado a norma C; ruido N(0, σ²C²) añadido a la suma por un servidor de confianza; división por la constante pública m̄ = ${r.dpfed.publicDenominator}.`,
      ],
      limitations: [
        'Modelo de regresión logística de 3 parámetros y datos sintéticos 2D.',
        'Aleatoriedad con semilla (no segura). Sin agregación segura implementada.',
        'La DP central no protege frente al servidor de agregación, que ve cada Δ_k.',
        'Coste de comunicación: solo bytes de parámetros float32.',
      ],
      privacyGuarantee:
        acc.status === 'computed'
          ? `(ε = ${acc.epsilon.toFixed(3)}, δ = ${fmtDelta(acc.delta)})-DP a nivel de cliente para D frente a observadores de los modelos globales publicados (no frente al servidor), bajo los supuestos indicados.`
          : null,
      privacy: privacyRecord(dpFedAvgSpec(p.adjacency), acc, { clipNorm: p.clipNorm, noiseMultiplier: p.noiseMultiplier }),
    });
  };

  const runSweep = async () => {
    if (errors.length) return;
    const r = await sweepTask.run({ data, fed, noiseMultipliers: SWEEP_SIGMAS, clipNorms: SWEEP_CLIPS, repeats: SWEEP_REPEATS, delta: p.delta, adjacency: p.adjacency });
    if (r) setSweep({ params: p, rows: r.rows, baselineAcc: r.baselineAcc, uniformAcc: r.uniformAcc });
  };

  const restore = (r: ExperimentRun) => {
    const g = (k: string) => r.params[k] ?? r.dataConfig?.[k];
    const adjLabel = g('vecindad');
    setP({
      ...p,
      numClients: Number(g('clientes') ?? p.numClients),
      samplesPerClient: Number(g('muestras/cliente') ?? p.samplesPerClient),
      sizeSkew: Number(g('asimetría de tamaños') ?? p.sizeSkew),
      nonIid: g('distribución') === 'Non-IID',
      classImbalance: Number(g('desequilibrio de clases') ?? p.classImbalance),
      featureShift: Number(g('desplazamiento de características') ?? p.featureShift),
      rounds: Number(g('rondas') ?? p.rounds),
      localEpochs: Number(g('épocas locales') ?? p.localEpochs),
      localLr: Number(g('tasa de aprendizaje') ?? p.localLr),
      batchSize: Number(g('tamaño de lote') ?? p.batchSize),
      participationPct: Number(g('participación (%)') ?? p.participationPct),
      clipNorm: Number(g('C (recorte)') ?? p.clipNorm),
      noiseMultiplier: Number(g('σ (ruido)') ?? p.noiseMultiplier),
      delta: Number(g('δ') ?? p.delta),
      adjacency: adjLabel === ADJACENCY_INFO.replace.label ? 'replace' : adjLabel === ADJACENCY_INFO['add-remove'].label ? 'add-remove' : p.adjacency,
      noiseRepeats: Number(g('repeticiones del ruido') ?? p.noiseRepeats),
      seed: r.seed ?? p.seed,
    });
  };

  const sweepChart = useMemo(() => {
    if (!sweep) return [];
    return SWEEP_SIGMAS.map((s) => {
      const row: Record<string, number | string> = { sigma: s === 0 ? '0 (solo recorte)' : String(s) };
      for (const c of SWEEP_CLIPS) {
        const r = sweep.rows.find((x) => x.noiseMultiplier === s && x.clipNorm === c);
        if (r) row[`C=${c}`] = r.accMean;
      }
      return row;
    });
  }, [sweep]);

  const accSeries = useMemo(() => (result ? result.series.map((s) => ({ ...s, dpBand: [Math.max(0, s.dpfed - s.dpfedStd), Math.min(1, s.dpfed + s.dpfedStd)] as [number, number] })) : []), [result]);

  /** Datos del gráfico de cascada B1 → D. */
  const waterfall = useMemo(() => {
    if (!result) return [];
    const d = result.decomposition;
    const b1 = result.fedavg.finalAcc;
    const steps = [
      { name: 'B1 ponderado', lo: 0, hi: b1, delta: b1, kind: 'total' as const, note: 'precisión de partida' },
      { name: '+ ponderación', lo: Math.min(b1, b1 + d.weighting), hi: Math.max(b1, b1 + d.weighting), delta: d.weighting, kind: 'step' as const, note: 'B2 − B1' },
      { name: '+ recorte', lo: Math.min(b1 + d.weighting, b1 + d.weighting + d.clipping), hi: Math.max(b1 + d.weighting, b1 + d.weighting + d.clipping), delta: d.clipping, kind: 'step' as const, note: 'C − B2' },
      {
        name: '+ ruido',
        lo: Math.min(result.clipped.finalAcc, result.dpfed.finalAcc),
        hi: Math.max(result.clipped.finalAcc, result.dpfed.finalAcc),
        delta: d.noise,
        kind: 'step' as const,
        note: `D − C (± ${num(d.noiseStd * 100, 2)} p.p.)`,
      },
      { name: 'D DP-FedAvg', lo: 0, hi: result.dpfed.finalAcc, delta: result.dpfed.finalAcc, kind: 'total' as const, note: `media de ${result.noiseRepeats} semillas` },
    ];
    return steps.map((s) => ({ ...s, range: [s.lo, Math.max(s.hi, s.lo + 0.0004)] as [number, number] }));
  }, [result]);
  const wfDomain = useMemo<[number, number]>(() => {
    if (!result) return [0, 1];
    const vals = [result.fedavg.finalAcc, result.uniform.finalAcc, result.clipped.finalAcc, result.dpfed.finalAcc];
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.03) * 50) / 50);
    const hi = Math.min(1, Math.ceil((Math.max(...vals) + 0.01) * 50) / 50);
    return [lo, hi];
  }, [result]);

  const usedParams = stored?.params ?? p;
  const usedM = result?.dpfed.publicDenominator ?? numSelected(usedParams.numClients, usedParams.participationPct / 100);
  const usedK = clippedSumSensitivityMultiple(usedParams.adjacency);
  const acc = result?.dpfed.accounting;
  const last = result ? result.series[result.series.length - 1] : null;

  const config = (
    <>
      <ConfigSection title="Datos (escenario de hospitales)">
        <ParamSlider label={<>Número de clientes (hospitales)</>} ariaLabel="Número de clientes" value={p.numClients} onChange={set('numClients')} min={2} max={10} step={1} />
        <ParamSlider label="Muestras por cliente" ariaLabel="Muestras por cliente" value={p.samplesPerClient} onChange={set('samplesPerClient')} min={20} max={600} step={10} />
        <ParamSlider
          label="Asimetría de tamaños"
          ariaLabel="Asimetría de tamaños de los clientes"
          value={p.sizeSkew}
          onChange={set('sizeSkew')}
          min={0}
          max={1}
          step={0.05}
          help="Con 0 todos los hospitales tienen el mismo tamaño y ponderar por n_k/N equivale a ponderar uniformemente (efecto de ponderación = 0)."
        />
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
        <ParamSlider label={<Term k="batchSize">Tamaño de lote</Term>} ariaLabel="Tamaño de lote" value={p.batchSize} onChange={set('batchSize')} min={1} max={128} step={1} help="Si supera las muestras de un cliente, ese cliente usa todo su conjunto en cada paso." />
        <ParamSlider
          label={<Term k="participation">Participación de clientes</Term>}
          ariaLabel="Participación de clientes"
          value={p.participationPct}
          onChange={set('participationPct')}
          min={10}
          max={100}
          step={5}
          unit="%"
          help={`m̄ = ${m} de ${p.numClients} clientes por ronda (constante pública).`}
        />
      </ConfigSection>
      <ConfigSection title="Privacidad diferencial (configuración D)">
        <ParamSlider label={<Term k="clipping">Norma de recorte C</Term>} ariaLabel="Norma de recorte" value={p.clipNorm} onChange={set('clipNorm')} min={0.01} max={5} step={0.01} log help="Se usa también en C (recorte sin ruido)." />
        <ParamSlider label={<Term k="noiseMultiplier">Multiplicador de ruido σ</Term>} ariaLabel="Multiplicador de ruido" value={p.noiseMultiplier} onChange={set('noiseMultiplier')} min={0} max={8} step={0.05} />
        <ParamChoice label={<Term k="delta">δ</Term>} value={p.delta} options={[0.01, 0.001, 0.0001, 0.00001] as const} onChange={set('delta')} format={(v) => v.toExponential(0)} help={`Debe ser mucho menor que 1/(nº de clientes) = ${num(1 / p.numClients)}.`} />
        <AdjacencyChoice value={p.adjacency} onChange={set('adjacency')} unitLabel="cliente (hospital)" />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {p.adjacency === 'add-remove'
            ? p.participationPct < 100
              ? 'Con añadir/eliminar y participación parcial, ε se mostrará como «No calculado».'
              : 'Añadir/eliminar con participación total: Δ₂ = C por ronda.'
            : 'Reemplazar (K público): Δ₂ = 2C; admite participación parcial con cota conservadora (el cliente podría participar en las T rondas).'}
        </p>
        <ParamSlider
          label="Repeticiones del ruido"
          ariaLabel="Repeticiones del ruido"
          value={p.noiseRepeats}
          onChange={set('noiseRepeats')}
          min={1}
          max={20}
          step={1}
          help="D se ejecuta R veces cambiando solo la semilla del ruido, para separar el efecto del ruido de su variabilidad."
        />
      </ConfigSection>
      <ConfigSection title="Reproducibilidad">
        <SeedControl value={p.seed} onChange={set('seed')} />
      </ConfigSection>
      <ErrorList errors={errors} />
      <Button className="w-full" onClick={run} disabled={!!errors.length || compareTask.running}>
        {compareTask.running ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar A, B1, B2, C y D
      </Button>
      {compareTask.error && <Callout kind="danger">{compareTask.error}</Callout>}
    </>
  );

  const configCards = [
    { k: 'A', t: 'Centralizado (referencia)', d: 'Los hospitales envían sus registros a un servidor que entrena el modelo.', c: CFG.A.color },
    { k: 'B1', t: 'FedAvg ponderado (n_k/N)', d: 'FedAvg estándar: media de modelos locales ponderada por muestras. Sin recorte ni ruido.', c: CFG.B1.color },
    { k: 'B2', t: 'FedAvg uniforme (1/m̄)', d: 'Igual que B1 pero cada hospital pesa lo mismo. Aísla el efecto de la ponderación.', c: CFG.B2.color },
    { k: 'C', t: 'Uniforme + recorte, sin ruido', d: 'Cada Δ_k se recorta a norma C. NO es privacidad diferencial: sin ruido no hay garantía.', c: CFG.C.color },
    { k: 'D', t: 'DP-FedAvg', d: 'Mismo recorte y ponderación que C, más ruido gaussiano N(0, σ²C²) sobre la suma.', c: CFG.D.color },
  ];

  const visual = (
    <>
      <VisualCard
        title="Cinco configuraciones, mismas condiciones"
        description="Mismos datos sintéticos, misma partición de test, misma selección de clientes y mismo entrenamiento local. Cada paso añade UNA transformación."
        actions={<IntegrityBadge kind="sim" />}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {configCards.map((x) => (
            <div key={x.k} className="rounded-md border p-3" style={{ borderTopColor: x.c, borderTopWidth: 3 }}>
              <p className="text-sm font-semibold">
                {x.k} — {x.t}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.d}</p>
            </div>
          ))}
        </div>
        {stale && <Callout kind="warn" className="mt-3">Los parámetros han cambiado desde la última ejecución. Pulsa «Ejecutar» para actualizar los resultados.</Callout>}
      </VisualCard>

      {result ? (
        <>
          <VisualCard title="Precisión en el conjunto de test global por ronda" actions={<IntegrityBadge kind="real" />}>
            <ChartFrame
              title="Precisión de test por ronda"
              description={`Para A, cada «ronda» equivale a tantas épocas centralizadas como épocas locales. D: media de ${result.noiseRepeats} semillas de ruido; la banda sombreada es ± 1 desviación típica.`}
              data={result.series}
              columns={[
                { key: 'round', label: 'Ronda' },
                { key: 'central', label: 'A', format: (v) => pct(v as number) },
                { key: 'fedavg', label: 'B1', format: (v) => pct(v as number) },
                { key: 'uniform', label: 'B2', format: (v) => pct(v as number) },
                { key: 'clipped', label: 'C', format: (v) => pct(v as number) },
                { key: 'dpfed', label: 'D (media)', format: (v) => pct(v as number) },
                { key: 'dpfedStd', label: 'D (desv.)', format: (v) => pct(v as number) },
              ]}
            >
              <ComposedChart data={accSeries} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="round" {...axisProps} label={{ value: 'Ronda', position: 'insideBottomRight', offset: -2, fill: C.axis, fontSize: 11 }} />
                <YAxis {...axisProps} domain={[0.3, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Tooltip {...tooltipProps} formatter={(v: number | number[]) => (Array.isArray(v) ? `${pct(v[0])} – ${pct(v[1])}` : pct(v))} />
                <Legend {...legendProps} />
                <Area type="monotone" dataKey="dpBand" name="D ± 1 desv." stroke="none" fill={CFG.D.color} fillOpacity={0.15} isAnimationActive={false} />
                {(['A', 'B1', 'B2', 'C', 'D'] as const).map((k) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={CFG[k].key}
                    name={CFG[k].label}
                    stroke={CFG[k].color}
                    strokeWidth={2}
                    strokeDasharray={k === 'C' ? '2 3' : k === 'D' ? '5 3' : undefined}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ChartFrame>
          </VisualCard>
          <VisualCard title="Pérdida de entrenamiento (entropía cruzada) por ronda" actions={<IntegrityBadge kind="real" />}>
            <ChartFrame
              title="Pérdida de entrenamiento"
              description="Pérdida global ponderada por n_k, evaluada con el modelo global de cada configuración (instrumentación: usa datos privados sin ruido). D: media de las semillas de ruido."
              height={220}
              data={result.series}
              columns={[
                { key: 'round', label: 'Ronda' },
                { key: 'centralLoss', label: 'A' },
                { key: 'fedavgLoss', label: 'B1' },
                { key: 'uniformLoss', label: 'B2' },
                { key: 'clippedLoss', label: 'C' },
                { key: 'dpfedLoss', label: 'D' },
              ]}
            >
              <LineChart data={result.series} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="round" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtNum(2)} />
                <Tooltip {...tooltipProps} formatter={fmtNum(4)} />
                <Legend {...legendProps} />
                {(['A', 'B1', 'B2', 'C', 'D'] as const).map((k) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={`${CFG[k].key}Loss`}
                    name={CFG[k].label}
                    stroke={CFG[k].color}
                    strokeWidth={2}
                    strokeDasharray={k === 'C' ? '2 3' : k === 'D' ? '5 3' : undefined}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartFrame>
          </VisualCard>

          <VisualCard
            title="Descomposición de la diferencia de precisión"
            description="¿La reducción de precisión se debe al ruido de privacidad, al recorte de actualizaciones o a un cambio en la ponderación de los clientes?"
            actions={<IntegrityBadge kind="empirical" />}
          >
            <ChartFrame
              title="Cascada B1 → D (precisión final en el test global)"
              description="Cada barra intermedia muestra el cambio al añadir una única transformación. Verde: sube la precisión; rojo: la baja. Valores de esta ejecución."
              height={240}
              data={waterfall}
              columns={[
                { key: 'name', label: 'Paso' },
                { key: 'delta', label: 'Valor / cambio', format: (v) => num((v as number) * 100, 2) + ' %' },
                { key: 'note', label: 'Cálculo', format: (v) => String(v) },
              ]}
            >
              <BarChart data={waterfall} margin={{ top: 8, right: 12, bottom: 4, left: -4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} tick={{ fill: C.axis, fontSize: 10 }} />
                <YAxis {...axisProps} domain={wfDomain} allowDataOverflow tickFormatter={(v: number) => `${num(v * 100, 1)}%`} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(_v: unknown, _n: unknown, item: { payload?: { kind: string; delta: number; note: string } }) => {
                    const pl = item.payload;
                    if (!pl) return '';
                    return [pl.kind === 'total' ? pct(pl.delta) : pp(pl.delta), pl.note];
                  }}
                />
                <Bar dataKey="range" isAnimationActive={false}>
                  {waterfall.map((s) => (
                    <Cell key={s.name} fill={s.kind === 'total' ? C.c1 : s.delta >= 0 ? C.ok : 'hsl(var(--destructive))'} />
                  ))}
                </Bar>
              </BarChart>
            </ChartFrame>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <StatTile label="Ponderación (B2 − B1)" value={pp(result.decomposition.weighting)} sub={usedParams.sizeSkew === 0 ? 'tamaños iguales ⇒ 0' : 'pesos n_k/N → 1/m̄'} />
              <StatTile label="Recorte (C − B2)" value={pp(result.decomposition.clipping)} sub={`${pct(result.clipped.clippedFraction)} recortadas`} />
              <StatTile label="Ruido (D − C)" value={pp(result.decomposition.noise)} sub={`± ${num(result.decomposition.noiseStd * 100, 2)} p.p. (R = ${result.noiseRepeats})`} tone="dp" />
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Descomposición <strong>secuencial y empírica</strong> con esta semilla y estos datos: B1 → B2 cambia solo los pesos, B2 → C añade solo el recorte y C → D añade solo el ruido (las tres usan la misma selección de
              clientes y el mismo entrenamiento local de la primera ronda). Si los efectos interactúan, otro orden podría repartir la diferencia de otra manera. El efecto de la ponderación es exactamente 0 cuando todos los
              hospitales tienen el mismo tamaño (asimetría de tamaños = 0).
            </p>
            <div className="mt-3">
              <ContextualCheck question="¿Qué parte de la diferencia de precisión corresponde al clipping y cuál al ruido?" explanation={stale ? null : decompositionExplanation(result, usedParams)} pendingHint="Los parámetros han cambiado: vuelve a ejecutar para obtener una explicación basada en tus resultados." />
            </div>
          </VisualCard>

          <VisualCard title="Comparación de configuraciones" description="Métricas calculadas en la última ejecución; las filas cualitativas se indican como tales.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-xs">
                <caption className="sr-only">Comparación entre centralizado, FedAvg ponderado, FedAvg uniforme, recorte sin ruido y DP-FedAvg</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-1.5 pr-2 text-left font-medium text-muted-foreground">
                      Aspecto
                    </th>
                    {(['A', 'B1', 'B2', 'C', 'D'] as const).map((k) => (
                      <th key={k} scope="col" className="px-2 py-1.5 text-left" style={{ borderBottom: `2px solid ${CFG[k].color}` }}>
                        {CFG[k].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:py-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:align-top [&_th]:font-normal [&_tr]:border-b">
                  <tr>
                    <th scope="row">Precisión final (test global)</th>
                    <td className="num">{pct(result.central.finalAcc)}</td>
                    <td className="num">{pct(result.fedavg.finalAcc)}</td>
                    <td className="num">{pct(result.uniform.finalAcc)}</td>
                    <td className="num">{pct(result.clipped.finalAcc)}</td>
                    <td className="num">
                      {pct(result.dpfed.finalAcc)} ± {num(result.dpfed.finalAccStd * 100, 2)} p.p.
                      <span className="block font-sans text-muted-foreground">media de {result.noiseRepeats} semillas de ruido</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Pérdida de entrenamiento final</th>
                    <td className="num">{num(last!.centralLoss, 4)}</td>
                    <td className="num">{num(last!.fedavgLoss, 4)}</td>
                    <td className="num">{num(last!.uniformLoss, 4)}</td>
                    <td className="num">{num(last!.clippedLoss, 4)}</td>
                    <td className="num">{num(last!.dpfedLoss, 4)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Comunicación (modelo simplificado)</th>
                    <td className="num">
                      {formatBytes(result.central.rawDataBytes)} <span className="font-sans text-muted-foreground">de datos brutos, una vez</span>
                    </td>
                    <td className="num">{formatBytes(result.fedavg.bytes)}</td>
                    <td className="num">{formatBytes(result.uniform.bytes)}</td>
                    <td className="num">{formatBytes(result.clipped.bytes)}</td>
                    <td className="num">{formatBytes(result.dpfed.bytes)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Cómputo (evaluaciones de gradiente)</th>
                    <td className="num">{result.central.gradEvals.toLocaleString('es-ES')}</td>
                    <td className="num">{result.fedavg.gradEvals.toLocaleString('es-ES')}</td>
                    <td className="num">{result.uniform.gradEvals.toLocaleString('es-ES')}</td>
                    <td className="num">
                      {result.clipped.gradEvals.toLocaleString('es-ES')}
                      <span className="block font-sans text-muted-foreground">+ recorte de {usedM} Δ por ronda</span>
                    </td>
                    <td className="num">
                      {result.dpfed.gradEvals.toLocaleString('es-ES')}
                      <span className="block font-sans text-muted-foreground">+ recorte y ruido de 3 coordenadas por ronda (por semilla)</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      Exposición de datos brutos <span className="text-muted-foreground">(cualitativo)</span>
                    </th>
                    <td>Todos los registros salen de cada hospital hacia el servidor.</td>
                    <td colSpan={2}>No salen registros; se envían modelos locales completos.</td>
                    <td colSpan={2}>No salen registros; se envían Δ_k, que el servidor recorta (y en D le añade ruido) tras verlos en claro.</td>
                  </tr>
                  <tr>
                    <th scope="row">Información en las actualizaciones</th>
                    <td className="text-muted-foreground">No aplica (el servidor ve los datos).</td>
                    <td>
                      ‖Δ_k‖ medio = <span className="num">{num(result.fedavg.meanUpdateNorm)}</span>, sin cota.
                    </td>
                    <td>
                      ‖Δ_k‖ medio = <span className="num">{num(result.uniform.meanUpdateNorm)}</span>, sin cota.
                    </td>
                    <td>
                      Influencia de cada cliente acotada por C/m̄ = <span className="num">{num(usedParams.clipNorm / usedM, 4)}</span>; recortadas: <span className="num">{pct(result.clipped.clippedFraction)}</span>. Sin ruido, el modelo
                      sigue siendo función determinista de los datos.
                    </td>
                    <td>
                      Igual acotación C/m̄ + ruido σC/m̄ = <span className="num">{num(result.dpfed.noiseStdPerCoord, 4)}</span> por coordenada; recortadas: <span className="num">{pct(result.dpfed.clippedFraction)}</span>.
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Garantía de privacidad</th>
                    <td>Ninguna; confianza total en el servidor central.</td>
                    <td>Ninguna. El servidor ve cada actualización.</td>
                    <td>Ninguna. El servidor ve cada actualización.</td>
                    <td>
                      <IntegrityBadge kind="not-computed" /> Ninguna: el recorte sin ruido no es DP.
                    </td>
                    <td>
                      {acc?.status === 'computed' ? (
                        <>
                          <IntegrityBadge kind="formal" />{' '}
                          <span className="num">
                            (ε = {num(acc.epsilon)}, δ = {fmtDelta(acc.delta)})
                          </span>{' '}
                          a nivel de cliente frente a observadores externos; no frente al servidor.
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
        <Callout>Configura el escenario y pulsa «Ejecutar A, B1, B2, C y D». Todas las curvas y métricas se calculan en tu navegador (en un Web Worker).</Callout>
      )}

      <PrivacyModelCard
        spec={dpFedAvgSpec(p.adjacency)}
        accounting={liveAccounting}
        extra={<p className="text-[11px] text-muted-foreground">Contabilidad calculada para los parámetros actuales de la configuración D (no requiere entrenar).</p>}
      />

      <VisualCard title="¿Frente a quién protege la DP central?" description="Dos modelos de amenaza distintos que no deben confundirse." actions={<IntegrityBadge kind="concept" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-ok/40 bg-ok/5 p-3 text-[13px] leading-relaxed">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <Globe className="h-4 w-4 text-ok" aria-hidden /> Frente a observadores externos
            </p>
            <p>
              Otros hospitales, analistas o usuarios que solo ven los <strong>modelos globales publicados</strong> w₁, …, w_T. Para ellos, D ofrece una garantía (ε, δ) a nivel de cliente si σ &gt; 0 y se cumplen los supuestos
              (recorte a C, denominador público m̄, vecindad indicada, todos los modelos intermedios contabilizados).
            </p>
          </div>
          <div className="rounded-md border border-warn/40 bg-warn/5 p-3 text-[13px] leading-relaxed">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <Eye className="h-4 w-4 text-warn" aria-hidden /> Frente al servidor de agregación
            </p>
            <p>
              <strong>Ninguna garantía.</strong> El servidor recibe cada Δ_k en claro, lo recorta y luego añade el ruido: ve exactamente lo mismo que en B1/B2. La DP del lado del servidor no impide que el servidor observe las
              actualizaciones individuales. Para reducir esa confianza harían falta agregación segura y/o ruido distribuido o local (modo conceptual más abajo).
            </p>
          </div>
        </div>
      </VisualCard>

      <VisualCard
        title="Compromiso privacidad–utilidad"
        description={`Precisión final media de D al variar σ, para varias normas de recorte C. ${SWEEP_REPEATS} repeticiones por punto cambiando SOLO la semilla del ruido.`}
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
            {sweepStale && <Callout kind="warn" className="mb-3">El barrido se calculó con otros parámetros de datos/entrenamiento/vecindad. Vuelve a ejecutarlo para actualizarlo.</Callout>}
            <ChartFrame
              title="Precisión de test frente a multiplicador de ruido σ"
              description={`Líneas de referencia: B1 FedAvg ponderado (${pct(sweep.baselineAcc)}) y B2 FedAvg uniforme (${pct(sweep.uniformAcc)}). σ = 0 es «solo recorte (no DP)». ε solo aparece en la tabla cuando la contabilidad es válida.`}
              data={sweep.rows}
              columns={[
                { key: 'noiseMultiplier', label: 'σ', format: (v) => ((v as number) === 0 ? '0 (solo recorte, no DP)' : String(v)) },
                { key: 'clipNorm', label: 'C' },
                { key: 'accMean', label: 'Precisión media', format: (v) => pct(v as number) },
                { key: 'accStd', label: 'Desv. típica (ruido)', format: (v) => pct(v as number) },
                { key: 'epsilon', label: `ε (δ=${fmtDelta(sweep.params.delta)})`, format: (v) => (typeof v === 'number' ? num(v) : '—') },
              ]}
            >
              <LineChart data={sweepChart} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="sigma" type="category" {...axisProps} tick={{ fill: C.axis, fontSize: 10 }} label={{ value: 'σ', position: 'insideBottomRight', offset: -2, fill: C.axis, fontSize: 11 }} />
                <YAxis {...axisProps} domain={[0.3, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Tooltip {...tooltipProps} formatter={(v: number) => pct(v)} labelFormatter={(l) => `σ = ${l}`} />
                <Legend {...legendProps} />
                <ReferenceLine y={sweep.baselineAcc} stroke={CFG.B1.color} strokeDasharray="4 4" label={{ value: 'B1 ponderado', fill: C.muted, fontSize: 10, position: 'insideBottomLeft' }} />
                <ReferenceLine y={sweep.uniformAcc} stroke={CFG.B2.color} strokeDasharray="2 4" label={{ value: 'B2 uniforme', fill: C.muted, fontSize: 10, position: 'insideTopLeft' }} />
                {SWEEP_CLIPS.map((c, i) => (
                  <Line key={c} type="monotone" dataKey={`C=${c}`} name={`C = ${c}`} stroke={SERIES[(i + 5) % SERIES.length]} strokeWidth={2} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartFrame>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              La desviación típica de la tabla refleja solo la variabilidad del ruido: datos, selección de clientes y entrenamiento local son idénticos en todas las repeticiones. Los puntos con σ = 0 tienen una sola ejecución
              (no hay ruido que repetir) y no tienen ε: el recorte sin ruido no es privacidad diferencial.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Ejecuta el barrido para ver cómo cambia la precisión al aumentar el ruido. Usa los parámetros de datos, entrenamiento y vecindad actuales.</p>
        )}
        <div className="mt-3 grid gap-2 text-[13px] leading-relaxed md:grid-cols-2">
          <p>
            <strong>Más ruido (σ ↑):</strong> la desviación del ruido es σC/m̄ por coordenada. Enmascara mejor la contribución de cualquier cliente (cada Δ_k pesa como mucho C/m̄), pero también la señal útil común: el modelo
            se mueve de forma más aleatoria y la precisión baja o se vuelve inestable.
          </p>
          <p>
            <strong>Recorte C:</strong> un C pequeño recorta casi todas las actualizaciones y sesga la dirección del aprendizaje (sesgo), pero el ruido absoluto σC es menor. Un C grande no recorta (sin sesgo) pero exige más ruido
            absoluto para la misma σ (más varianza). Compara la fila σ = 0 de cada C con B2 para ver el efecto del recorte por sí solo.
          </p>
        </div>
      </VisualCard>

      <VisualCard
        title="Modo conceptual — DP-FedAvg + agregación segura"
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
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="A centralizado" value={pct(result.central.finalAcc)} />
        <StatTile label="B1 ponderado" value={pct(result.fedavg.finalAcc)} tone="fl" />
        <StatTile label="B2 uniforme" value={pct(result.uniform.finalAcc)} />
        <StatTile label="C recorte (no DP)" value={pct(result.clipped.finalAcc)} />
        <StatTile className="col-span-2" label={`D DP-FedAvg (media de ${result.noiseRepeats})`} value={`${pct(result.dpfed.finalAcc)} ± ${num(result.dpfed.finalAccStd * 100, 2)} p.p.`} tone="dp" />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold">Garantía de privacidad de D</p>
        {acc?.status === 'computed' ? (
          <>
            <IntegrityBadge kind="formal" />
            <p className="num text-lg font-semibold text-dp">
              ε = {num(acc.epsilon)}, δ = {fmtDelta(acc.delta)}
            </p>
            <p className="text-xs text-muted-foreground">
              Nivel de cliente, {ADJACENCY_INFO[usedParams.adjacency].label.toLowerCase()}, {acc.details.compositions} composiciones con Δ₂ = {usedK === 1 ? 'C' : '2C'}. Solo frente a observadores de los modelos publicados.
              Supuestos completos en «Modelo de privacidad».
            </p>
          </>
        ) : (
          <>
            <IntegrityBadge kind="not-computed" />
            <p className="text-xs leading-relaxed">{acc?.status === 'not-computed' ? acc.reason : ''}</p>
          </>
        )}
      </div>
      <Callout kind="info" title="Qué observar">
        La distancia B1 → D no es «el coste de la DP»: parte se debe a la ponderación (B1 → B2) y al recorte (B2 → C), que no aportan privacidad por sí solos. Solo C → D es el efecto del ruido. La comunicación es idéntica en
        B1, B2, C y D.
      </Callout>
      <Callout kind="warn" title="Cuidado al interpretar">
        Que D tenga una precisión similar a B1 no significa que la privacidad sea «gratis»: con pocos clientes, el ruido σC/m̄ es grande frente a la señal, y con σ pequeña ε crece. Un ε grande ofrece poca protección.
      </Callout>
      <p className="text-[11px] text-muted-foreground">Con solo {usedParams.numClients} clientes, la DP a nivel de cliente es muy difícil: cada cliente es una fracción enorme de los datos. En la práctica se usa con miles de clientes.</p>
    </>
  ) : (
    <p className="text-sm text-muted-foreground">Las observaciones aparecerán tras la primera ejecución.</p>
  );

  const details = result ? (
    <ShowCalculations
      equations={[
        'Δ_k = w_k − w_t                                        (actualización local del cliente k)',
        'B1 (ponderado):  w_{t+1} = Σ_k (n_k / N) · w_k',
        'B2 (uniforme):   w_{t+1} = w_t + (1/m̄) Σ_k Δ_k',
        'C  (recorte):    w_{t+1} = w_t + (1/m̄) Σ_k clip(Δ_k, C),   clip(v, C) = v · min(1, C/‖v‖₂)',
        'D  (DP-FedAvg):  w_{t+1} = w_t + ( Σ_k clip(Δ_k, C) + N(0, σ²C² I) ) / m̄     (m̄ constante pública; ruido añadido por el servidor)',
        `Sensibilidad L2 de la suma: Δ₂ = k·C con k = ${usedK} (${usedParams.adjacency === 'replace' ? 'reemplazar' : 'añadir/eliminar'})`,
        'ε(δ) = min_α [ T·α / (2z²) + ln(1/δ) / (α − 1) ],   z = σ / k',
      ]}
      inputs={[
        { label: 'Unidad de privacidad', value: 'cliente (todos sus registros)' },
        { label: 'Vecindad', value: ADJACENCY_INFO[usedParams.adjacency].label },
        { label: 'C (norma de recorte)', value: usedParams.clipNorm },
        { label: 'σ (multiplicador de ruido)', value: usedParams.noiseMultiplier },
        { label: 'm̄ (clientes por ronda, constante pública)', value: usedM },
        { label: 'T (rondas)', value: usedParams.rounds },
        { label: 'δ', value: fmtDelta(usedParams.delta) },
        { label: 'R (repeticiones del ruido)', value: result.noiseRepeats },
        { label: 'Tamaños n_k de los clientes', value: result.clientSizes.join(', ') },
      ]}
      intermediates={[
        { label: 'k (múltiplo de sensibilidad)', value: usedK },
        { label: 'Δ₂ = k·C', value: num(usedK * usedParams.clipNorm, 4) },
        { label: 'z = σ/k (multiplicador efectivo)', value: num(usedParams.noiseMultiplier / usedK, 4) },
        { label: 'Desv. del ruido sobre la suma σC', value: num(usedParams.noiseMultiplier * usedParams.clipNorm, 4) },
        { label: 'Desv. del ruido en el modelo σC/m̄', value: num(result.dpfed.noiseStdPerCoord, 4) },
        { label: 'Influencia máx. de un cliente C/m̄', value: num(usedParams.clipNorm / usedM, 4) },
        { label: 'Composiciones contabilizadas T', value: acc?.status === 'computed' ? acc.details.compositions : '—' },
        { label: '‖Δ_k‖ medio (D, antes de recortar)', value: num(result.dpfed.meanUpdateNorm, 4) },
        { label: 'Fracción de Δ_k recortadas (C / D)', value: `${pct(result.clipped.clippedFraction)} / ${pct(result.dpfed.clippedFraction)}` },
        { label: 'Épocas centralizadas (A)', value: result.central.epochs },
      ]}
      outputs={[
        { label: 'Precisión A / B1 / B2 / C', value: `${pct(result.central.finalAcc)} / ${pct(result.fedavg.finalAcc)} / ${pct(result.uniform.finalAcc)} / ${pct(result.clipped.finalAcc)}` },
        { label: 'Precisión D por semilla de ruido', value: result.dpfed.finalAccs.map((a) => pct(a)).join(', ') },
        { label: 'Efectos: ponderación / recorte / ruido', value: `${pp(result.decomposition.weighting)} / ${pp(result.decomposition.clipping)} / ${pp(result.decomposition.noise)}` },
        { label: 'θ final B1', value: result.fedavg.finalParams.map((v) => num(v)).join(', ') },
        { label: 'θ final D (1.ª semilla)', value: result.dpfed.finalParams.map((v) => num(v)).join(', ') },
        { label: 'ε', value: acc?.status === 'computed' ? `${num(acc.epsilon)} (α* = ${num(acc.optimalAlpha, 2)})` : 'No calculado' },
      ]}
      assumptions={[
        'DP central: un servidor de confianza ve las Δ_k individuales y añade el ruido. La garantía protege frente a observadores de los modelos publicados, no frente a ese servidor.',
        'La media de C y D NO se pondera por n_k: los pesos dependerían de los datos y aumentarían la sensibilidad. Por eso B2 aísla el efecto de cambiar la ponderación.',
        'El denominador m̄ es una constante pública fijada de antemano (no el número de actualizaciones recibidas).',
        'D se repite con R semillas de ruido; datos, selección de clientes y entrenamiento local de la primera ronda son idénticos entre B2, C y D.',
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
      objective="Comparar en condiciones controladas el entrenamiento centralizado, FedAvg y DP-FedAvg a nivel de cliente, separando qué parte del cambio de precisión se debe a la ponderación, al recorte y al ruido, y qué supuestos necesita cada afirmación de privacidad."
      badges={['real', 'sim', 'empirical', 'formal', 'concept']}
      intro={
        <>
          <p>
            Volvemos a los hospitales del Módulo 2. Vimos que FedAvg evita mover registros, pero que las actualizaciones de modelo todavía dependen de los datos de cada hospital y pueden revelar información. ¿Podemos
            limitar formalmente cuánto influye un hospital concreto en el modelo publicado?
          </p>
          <p>
            DP-FedAvg aplica la idea de DP-SGD cambiando la <Term k="privacyUnit">unidad de privacidad</Term>: en lugar de un registro, protegemos a un <strong>cliente completo</strong>. El servidor recibe cada Δ_k, lo{' '}
            <Term k="clipping">recorta</Term> a norma C, hace una media <em>uniforme</em> dividiendo por una constante pública m̄ y añade <Term k="gaussian">ruido gaussiano</Term> N(0, σ²C²) a la suma.
          </p>
          <p>
            Pero DP-FedAvg cambia <strong>tres cosas a la vez</strong> respecto a FedAvg: la ponderación (n_k/N → 1/m̄), el recorte y el ruido. Para saber qué causa una pérdida de precisión, añadimos una transformación cada
            vez: B1 → B2 → C → D. Solo D, con σ &gt; 0, puede tener una garantía de privacidad diferencial.
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
          'Combinar FL y DP evita mover datos brutos y además acota la influencia de cada cliente en los modelos publicados.',
          'Con σ > 0 y una vecindad/participación admitidas se obtiene una garantía (ε, δ) formal a nivel de cliente, bajo supuestos explícitos.',
          'La comparación controlada B1 → B2 → C → D permite atribuir empíricamente el cambio de precisión a la ponderación, al recorte o al ruido.',
          'El coste de comunicación no aumenta respecto a FedAvg: el recorte y el ruido son baratos.',
        ],
        limitations: [
          'El ruido reduce la utilidad, sobre todo con pocos clientes: la DP a nivel de cliente necesita muchos participantes.',
          'La DP central requiere confiar en el servidor que añade el ruido; sin agregación segura ve cada actualización.',
          'Elegir C y σ es delicado (sesgo por recorte frente a varianza por ruido) y el ajuste con datos privados también consume privacidad.',
          'La cota calculada es conservadora (sin amplificación por muestreo); con añadir/eliminar solo aplica con participación total.',
          'La descomposición es empírica y depende del orden si los efectos interactúan.',
        ],
      }}
      reflection={{
        question:
          'Una red de 5 hospitales quiere un modelo con ε ≤ 3 a nivel de hospital. Según tus experimentos, ¿qué parte de la pérdida de precisión se debe realmente al ruido? ¿Es realista mantener una precisión cercana a FedAvg? ¿Qué cambiarías (número de clientes, rondas, σ, C, agregación segura) y por qué?',
        hint: 'Mira la cascada: el ruido es solo el último escalón. Observa cómo crece ε con las rondas y decrece con σ, y cómo el ruido en el modelo es σC/m̄: más clientes diluyen el ruido para la misma garantía.',
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
          <strong>Qué protege:</strong> en este diseño (distinto de la configuración D), el servidor ya no ve cada Δ_k individual, solo la suma. El recorte debería hacerlo cada cliente antes de enmascarar, y si cada cliente
          añade una parte del ruido (ruido distribuido), ningún actor necesita ser de confianza para añadirlo.
        </li>
        <li>
          <strong>Qué no protege:</strong> lo que revela la suma y el modelo final (para eso está la DP); clientes que abandonan a mitad de protocolo o se confabulan; clientes maliciosos que envían actualizaciones envenenadas o
          sin recortar.
        </li>
        <li>
          <strong>Ruido distribuido:</strong> si cada uno de m̄ clientes añade N(0, σ²C²/m̄), la suma tiene ruido N(0, σ²C²), pero solo si todos son honestos; si algunos omiten su parte, la garantía se debilita.
        </li>
      </ul>
      <Callout kind="warn">
        Esto es una ilustración conceptual. El laboratorio no implementa máscaras por pares, intercambio de claves ni gestión de abandonos: los resultados de la configuración D asumen un servidor de confianza que ve cada Δ_k.
      </Callout>
    </div>
  );
}
