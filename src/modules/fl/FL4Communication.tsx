import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamChoice, ParamSlider, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, SERIES, axisProps, gridProps, legendProps, tooltipProps } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { commGridByTarget, type GridCell as CommGridCell, type TargetMetric } from './commGrid';
import { DEFAULT_DATA_CONFIG, validateDataConfig, type DistributionMode, type FederatedDataConfig } from '@/lib/fl/data';
import { validateFedConfig, type FedAvgConfig } from '@/lib/fl/fedavg';
import { REFERENCE_MODELS, estimateCommunication, formatBytes } from '@/lib/fl/communication';
import { f, fromLabelled, pct, toLabelled } from './shared';

const ID = 'fl4';
const TITLE = 'Costes de comunicación y de sistema';

type ModelId = (typeof REFERENCE_MODELS)[number]['id'];

interface Params {
  modelId: ModelId;
  estClients: number;
  estParticipationPct: number;
  estRounds: number;
  bytesPerParam: number;
  gridClients: number;
  samplesPerClient: number;
  mode: DistributionMode;
  targetMetric: TargetMetric;
  targetLoss: number;
  targetAccPct: number;
  maxRounds: number;
  localLr: number;
  seed: number;
}
const DEFAULTS: Params = {
  modelId: 'lab',
  estClients: 100,
  estParticipationPct: 10,
  estRounds: 200,
  bytesPerParam: 4,
  gridClients: 10,
  samplesPerClient: 80,
  mode: 'iid',
  targetMetric: 'loss',
  targetLoss: 0.25,
  targetAccPct: 93,
  maxRounds: 80,
  localLr: 0.02,
  seed: 11,
};
const LABELS: Record<keyof Params, string> = {
  modelId: 'Modelo de referencia',
  estClients: 'Clientes (estimación)',
  estParticipationPct: 'Participación estimación (%)',
  estRounds: 'Rondas (estimación)',
  bytesPerParam: 'Bytes por parámetro',
  gridClients: 'Clientes (simulación)',
  samplesPerClient: 'Muestras por cliente',
  mode: 'Distribución',
  targetMetric: 'Métrica objetivo',
  targetLoss: 'Pérdida de test objetivo',
  targetAccPct: 'Precisión objetivo (%)',
  maxRounds: 'Rondas máximas',
  localLr: 'Tasa de aprendizaje local',
  seed: 'Semilla',
};

const EPOCHS = [1, 2, 5, 10];
const PARTS = [0.2, 0.5, 1];

const dataCfg = (p: Params): FederatedDataConfig => ({ ...DEFAULT_DATA_CONFIG, numClients: p.gridClients, samplesPerClient: p.samplesPerClient, mode: p.mode, seed: p.seed });
const fedCfg = (p: Params): FedAvgConfig => ({ rounds: p.maxRounds, localEpochs: 1, localLr: p.localLr, batchSize: 16, participation: 1, seed: p.seed, dp: null });

interface Result {
  params: Params;
  cells: CommGridCell[];
}

const targetText = (p: Params) => (p.targetMetric === 'loss' ? `pérdida de test ≤ ${f(p.targetLoss, 2)}` : `precisión de test ≥ ${p.targetAccPct} %`);
const partLabel = (p: number) => `${Math.round(p * 100)} % clientes`;

export default function FL4Communication() {
  const [params, setParams, resetParams] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const [result, setResult] = usePersistentState<Result | null>(`${ID}.result`, null, false);
  const [running, setRunning] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const { addRun } = useRuns(ID);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const model = REFERENCE_MODELS.find((m) => m.id === params.modelId) ?? REFERENCE_MODELS[0];

  const estimate = useMemo(
    () => estimateCommunication({ numParams: model.params, numClients: params.estClients, participation: params.estParticipationPct / 100, rounds: params.estRounds, bytesPerParam: params.bytesPerParam }),
    [model, params.estClients, params.estParticipationPct, params.estRounds, params.bytesPerParam],
  );
  const perModel = useMemo(
    () =>
      REFERENCE_MODELS.map((m) => ({
        modelo: m.name.split(' (')[0],
        bytes: estimateCommunication({ numParams: m.params, numClients: params.estClients, participation: params.estParticipationPct / 100, rounds: params.estRounds, bytesPerParam: params.bytesPerParam }).total,
        params: m.params,
      })),
    [params.estClients, params.estParticipationPct, params.estRounds, params.bytesPerParam],
  );

  const errors = useMemo(() => {
    const e = [...validateDataConfig(dataCfg(params)), ...validateFedConfig(fedCfg(params))];
    if (params.targetAccPct < 50 || params.targetAccPct > 99) e.push('La precisión objetivo debe estar entre 50 % y 99 %.');
    if (!(params.targetLoss > 0)) e.push('La pérdida objetivo debe ser positiva.');
    return e;
  }, [params]);

  const execute = useCallback(
    async (record: boolean, p: Params = params) => {
      setRunning(true);
      setTaskError(null);
      try {
        // Cálculo ligero (12 simulaciones de un modelo de 3 parámetros); se cede el hilo antes de empezar.
        await new Promise((r) => setTimeout(r, 20));
        const cells = commGridByTarget({ data: dataCfg(p), fed: fedCfg(p), localEpochsList: EPOCHS, participationList: PARTS, metric: p.targetMetric, target: p.targetMetric === 'loss' ? p.targetLoss : p.targetAccPct / 100 });
        setResult({ params: p, cells });
        if (record) {
          const reached = cells.filter((c) => c.bytesToTarget !== null);
          const best = reached.sort((a, b) => (a.bytesToTarget ?? 0) - (b.bytesToTarget ?? 0))[0];
          const m = REFERENCE_MODELS.find((x) => x.id === p.modelId)!;
          const est = estimateCommunication({ numParams: m.params, numClients: p.estClients, participation: p.estParticipationPct / 100, rounds: p.estRounds, bytesPerParam: p.bytesPerParam });
          addRun({
            experimentTitle: TITLE,
            seed: p.seed,
            params: toLabelled(p, LABELS),
            results: {
              'Estimación: bytes por ronda': est.perRound,
              'Estimación: bytes totales': est.total,
              'Configuraciones que alcanzan el objetivo': `${reached.length}/${cells.length}`,
              'Menor comunicación hasta objetivo (bytes)': best?.bytesToTarget ?? null,
              'Configuración más barata (E, participación)': best ? `E=${best.localEpochs}, ${Math.round(best.participation * 100)} %` : 'ninguna',
            },
            assumptions: ['Coste = solo carga útil de parámetros (bajada + subida).', `Mismos datos (${p.mode}) para todas las configuraciones de la malla.`, 'Objetivo (pérdida o precisión) medido en el conjunto de evaluación global fijo.'],
            limitations: ['No modela red real: cabeceras, cifrado, compresión, latencia, abandonos ni asimetría de ancho de banda.', 'Los resultados de la malla dependen de la semilla y del modelo lineal.'],
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

  const byEpoch = (metric: 'roundsToTarget' | 'bytesToTarget' | 'gradEvalsToTarget') =>
    EPOCHS.map((E) => {
      const row: Record<string, number | string | null> = { E: `E = ${E}` };
      PARTS.forEach((pp) => {
        const c = result?.cells.find((x) => x.localEpochs === E && x.participation === pp);
        row[`p${pp}`] = c ? c[metric] : null;
      });
      return row;
    });
  const roundsData = useMemo(() => byEpoch('roundsToTarget'), [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const bytesData = useMemo(() => byEpoch('bytesToTarget'), [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const gradData = useMemo(() => byEpoch('gradEvalsToTarget'), [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const partColumns = PARTS.map((pp) => ({ key: `p${pp}`, label: partLabel(pp), format: (v: unknown) => (v === null || v === undefined ? 'no alcanzado' : Number(v).toLocaleString('es-ES')) }));

  const reached = result?.cells.filter((c) => c.roundsToTarget !== null) ?? [];
  const minRounds = reached.length ? reached.reduce((a, b) => ((a.roundsToTarget ?? 1e9) <= (b.roundsToTarget ?? 1e9) ? a : b)) : null;
  const minGrads = reached.length ? reached.reduce((a, b) => ((a.gradEvalsToTarget ?? 1e18) <= (b.gradEvalsToTarget ?? 1e18) ? a : b)) : null;
  const bytesWithModel = (c: CommGridCell) => (c.roundsToTarget === null ? null : estimateCommunication({ numParams: model.params, numClients: result!.params.gridClients, participation: c.participation, rounds: c.roundsToTarget, bytesPerParam: params.bytesPerParam }).total);

  const chart = (title: string, description: string, data: Record<string, number | string | null>[], yLabel: (v: number) => string) => (
    <ChartFrame title={title} description={description} height={220} data={data} columns={[{ key: 'E', label: 'Épocas locales', format: (v) => String(v) }, ...partColumns]}>
      <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="E" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => yLabel(v as number)} width={56} />
        <RTooltip {...tooltipProps} formatter={(v) => (v === null || v === undefined ? 'no alcanzado' : yLabel(v as number))} />
        <Legend {...legendProps} />
        {PARTS.map((pp, i) => (
          <Bar key={pp} dataKey={`p${pp}`} name={partLabel(pp)} fill={SERIES[i]} />
        ))}
      </BarChart>
    </ChartFrame>
  );

  return (
    <ExperimentLayout
      experimentId={ID}
      module="fl"
      kicker="Experimento 4"
      title={TITLE}
      objective="Cuantificar el volumen de comunicación del Aprendizaje Federado y explorar el equilibrio entre cómputo local (épocas) y comunicación (rondas y clientes)."
      badges={['real', 'empirical', 'sim']}
      intro={
        <>
          <p>
            Un hospital rural con una conexión lenta tiene que descargar el modelo y subir su actualización en <em>cada</em> <Term k="round">ronda</Term>. Si el modelo tiene 100 millones de parámetros en float32, cada viaje son ~400 MB. Multiplicado por cientos de rondas
            y de clientes, la comunicación se convierte en el cuello de botella.
          </p>
          <p>
            Hacer más <Term k="localEpochs">épocas locales</Term> por ronda suele reducir el número de rondas necesarias (menos comunicación) a cambio de más cómputo en los clientes —y, con datos heterogéneos, más <Term k="clientDrift">deriva</Term>. Reducir la{' '}
            <Term k="participation">participación</Term> abarata cada ronda pero puede requerir más rondas.
          </p>
          <p>
            Este experimento usa un <strong>modelo de coste simplificado</strong>: solo cuenta los bytes de los parámetros. No es una medida de red real.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="A · Estimación analítica">
            <div className="space-y-1">
              <label htmlFor="fl4-model" className="text-xs font-medium">
                Tamaño del modelo
              </label>
              <NativeSelect id="fl4-model" value={params.modelId} onChange={(e) => set('modelId', e.target.value as ModelId)}>
                {REFERENCE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <ParamSlider label="Clientes totales" ariaLabel="Clientes totales" value={params.estClients} onChange={(v) => set('estClients', Math.round(v))} min={2} max={10000} step={1} log />
            <ParamSlider label={<Term k="participation">Participación</Term>} ariaLabel="Participación" value={params.estParticipationPct} onChange={(v) => set('estParticipationPct', v)} min={1} max={100} step={1} unit="%" />
            <ParamSlider label={<Term k="round">Rondas</Term>} ariaLabel="Rondas" value={params.estRounds} onChange={(v) => set('estRounds', Math.round(v))} min={1} max={5000} step={1} log />
            <ParamChoice label="Precisión numérica" value={params.bytesPerParam} options={[4, 2, 1] as const} format={(v) => (v === 4 ? 'float32 (4 B)' : v === 2 ? 'float16 (2 B)' : 'int8 (1 B)')} onChange={(v) => set('bytesPerParam', v)} help="La cuantización reduce bytes, pero puede afectar a la precisión (no simulado)." />
          </ConfigSection>
          <ConfigSection title="B · Simulación: cómputo vs comunicación">
            <ParamSlider label="Clientes simulados" ariaLabel="Clientes simulados" value={params.gridClients} onChange={(v) => set('gridClients', Math.round(v))} min={2} max={10} step={1} />
            <ParamSlider label="Muestras por cliente" ariaLabel="Muestras por cliente" value={params.samplesPerClient} onChange={(v) => set('samplesPerClient', Math.round(v))} min={20} max={400} step={10} />
            <ParamChoice label={<Term k="nonIid">Distribución</Term>} value={params.mode} options={['iid', 'non-iid'] as const} format={(v) => (v === 'iid' ? 'IID' : 'Non-IID')} onChange={(v) => set('mode', v)} />
            <ParamChoice
              label="Objetivo de convergencia"
              value={params.targetMetric}
              options={['loss', 'acc'] as const}
              format={(v) => (v === 'loss' ? 'Pérdida de test ≤' : 'Precisión de test ≥')}
              onChange={(v) => set('targetMetric', v)}
              help="La precisión es una métrica discreta y ruidosa en conjuntos pequeños; la pérdida suele mostrar la convergencia de forma más estable."
            />
            {params.targetMetric === 'loss' ? (
              <ParamSlider label="Pérdida de test objetivo" ariaLabel="Pérdida de test objetivo" value={params.targetLoss} onChange={(v) => set('targetLoss', v)} min={0.1} max={0.7} step={0.01} help="Con Non-IID la pérdida alcanzable es mayor (prueba ≈ 0,46)." />
            ) : (
              <ParamSlider label="Precisión objetivo" ariaLabel="Precisión objetivo" value={params.targetAccPct} onChange={(v) => set('targetAccPct', v)} min={50} max={99} step={1} unit="%" />
            )}
            <ParamSlider label="Rondas máximas" ariaLabel="Rondas máximas" value={params.maxRounds} onChange={(v) => set('maxRounds', Math.round(v))} min={5} max={150} step={5} />
            <ParamSlider label={<Term k="learningRate">Tasa de aprendizaje local</Term>} ariaLabel="Tasa de aprendizaje local" value={params.localLr} onChange={(v) => set('localLr', v)} min={0.01} max={1} step={0.01} />
            <p className="text-[11px] text-muted-foreground">Malla: épocas locales ∈ {'{'}1, 2, 5, 10{'}'} × participación ∈ {'{'}20 %, 50 %, 100 %{'}'}.</p>
            <SeedControl value={params.seed} onChange={(v) => set('seed', v)} />
          </ConfigSection>
          <ErrorList errors={errors} />
          {taskError && <ErrorList errors={[taskError]} />}
          <Button className="w-full" variant="fl" disabled={errors.length > 0 || running} onClick={() => void execute(true)}>
            {running ? <Loader2 className="animate-spin" /> : <Play />} {running ? 'Ejecutando 12 simulaciones…' : 'Ejecutar malla de simulaciones'}
          </Button>
        </>
      }
      visual={
        <>
          <VisualCard title="A · Volumen de comunicación estimado" description="Cálculo real con el modelo de coste simplificado (solo carga útil de parámetros).">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Parámetros del modelo" value={model.params.toLocaleString('es-ES')} />
              <StatTile label="Clientes por ronda" value={estimate.clientsPerRound.toLocaleString('es-ES')} />
              <StatTile label="Bytes por ronda" value={formatBytes(estimate.perRound)} sub={`↓ ${formatBytes(estimate.downPerRound)} · ↑ ${formatBytes(estimate.upPerRound)}`} tone="fl" />
              <StatTile label="Total estimado" value={formatBytes(estimate.total)} sub={`${params.estRounds} rondas`} tone="warn" />
            </div>
            <div className="mt-4">
              <ChartFrame
                title="Comunicación total por tamaño de modelo"
                description="Bytes totales (escala logarítmica) para cada modelo de referencia con los mismos clientes, participación y rondas."
                height={220}
                data={perModel}
                columns={[
                  { key: 'modelo', label: 'Modelo', format: (v) => String(v) },
                  { key: 'params', label: 'Parámetros' },
                  { key: 'bytes', label: 'Bytes totales', format: (v) => formatBytes(v as number) },
                ]}
              >
                <BarChart data={perModel} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="modelo" {...axisProps} interval={0} tick={{ fill: C.axis, fontSize: 10 }} />
                  <YAxis {...axisProps} scale="log" domain={['auto', 'auto']} tickFormatter={(v) => formatBytes(v as number)} width={70} allowDataOverflow />
                  <RTooltip {...tooltipProps} formatter={(v) => formatBytes(v as number)} />
                  <Bar dataKey="bytes" name="Bytes totales" fill={C.fl} />
                </BarChart>
              </ChartFrame>
            </div>
          </VisualCard>
          {result && (
            <VisualCard title="B · Equilibrio entre cómputo local y comunicación" description={`Resultados de ${result.cells.length} simulaciones FedAvg reales sobre los mismos datos; objetivo: ${targetText(result.params)}.`}>
              <div className="grid gap-4 lg:grid-cols-2">
                {chart('Rondas hasta alcanzar el objetivo', 'Número de rondas de comunicación necesarias (barras ausentes = objetivo no alcanzado en el máximo de rondas).', roundsData, (v) => v.toLocaleString('es-ES'))}
                {chart('Bytes hasta alcanzar el objetivo (modelo del laboratorio)', 'Bytes de parámetros intercambiados hasta alcanzar el objetivo con el modelo de 3 parámetros.', bytesData, (v) => formatBytes(v))}
                {chart('Cómputo local hasta el objetivo', 'Evaluaciones de gradiente por ejemplo sumadas en todos los clientes hasta alcanzar el objetivo.', gradData, (v) => (v >= 1000 ? `${f(v / 1000, 1)} mil` : String(v)))}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <caption className="mb-1 text-left text-xs font-medium">Extrapolación: bytes hasta el objetivo si el modelo fuera «{model.name.split(' (')[0]}»</caption>
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th scope="col" className="py-1 text-left font-medium">E</th>
                        {PARTS.map((pp) => (
                          <th key={pp} scope="col" className="py-1 text-right font-medium">
                            {partLabel(pp)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {EPOCHS.map((E) => (
                        <tr key={E} className="border-b last:border-0">
                          <th scope="row" className="py-1 text-left font-normal">
                            {E}
                          </th>
                          {PARTS.map((pp) => {
                            const c = result.cells.find((x) => x.localEpochs === E && x.participation === pp)!;
                            const b = bytesWithModel(c);
                            return (
                              <td key={pp} className="num py-1 text-right">
                                {b === null ? 'no alcanzado' : formatBytes(b)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-muted-foreground">Supone que un modelo mayor necesitaría las mismas rondas, lo cual no tiene por qué cumplirse: es solo una extrapolación ilustrativa.</p>
                </div>
              </div>
            </VisualCard>
          )}
        </>
      }
      observations={
        <>
          <p className="text-[13px] leading-relaxed">
            Con «{model.name.split(' (')[0]}», cada cliente participante descarga y sube <span className="num font-semibold">{formatBytes(model.params * params.bytesPerParam)}</span> por ronda.
          </p>
          {result && minRounds && minGrads ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Menos rondas" value={minRounds.roundsToTarget} sub={`E=${minRounds.localEpochs}, ${Math.round(minRounds.participation * 100)} %`} tone="fl" />
                <StatTile label="Menos cómputo" value={(minGrads.gradEvalsToTarget ?? 0).toLocaleString('es-ES')} sub={`E=${minGrads.localEpochs}, ${Math.round(minGrads.participation * 100)} %`} />
              </div>
              <p className="text-[13px] leading-relaxed">
                {reached.length} de {result.cells.length} configuraciones alcanzaron el objetivo ({targetText(result.params)}). Observa si la configuración con menos rondas coincide con la de menos cómputo: normalmente no, y esa es la esencia del equilibrio.
              </p>
            </>
          ) : result ? (
            <Callout kind="warn">Ninguna configuración alcanzó el objetivo. Relaja el objetivo o aumenta las rondas máximas.</Callout>
          ) : null}
          <Callout kind="info" title="Modelo de coste simplificado">
            Una red real añade cabeceras, cifrado TLS, reintentos, latencia y asimetría subida/bajada; la agregación segura añade además intercambio de claves y máscaras. Técnicas como compresión, cuantización o esparsificación reducen los bytes. Nada de esto está
            simulado.
          </Callout>
        </>
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => { const p = fromLabelled(r.params, LABELS, DEFAULTS); setParams(p); void execute(false, p); }} onReset={resetParams} />}
      details={
        <ShowCalculations
          equations={['m = max(1, round(p · K))', 'Bytes por ronda = m · P · b (bajada) + m · P · b (subida)', 'Total = R · bytes por ronda', 'Cómputo local por ronda = Σ_{k∈S} E · n_k evaluaciones de gradiente']}
          inputs={[
            { label: 'P (parámetros)', value: model.params.toLocaleString('es-ES') },
            { label: 'K (clientes)', value: params.estClients },
            { label: 'p (participación)', value: pct(params.estParticipationPct / 100, 0) },
            { label: 'R (rondas)', value: params.estRounds },
            { label: 'b (bytes/parámetro)', value: params.bytesPerParam },
          ]}
          intermediates={[
            { label: 'm (clientes por ronda)', value: estimate.clientsPerRound },
            { label: 'Bajada por ronda', value: `${estimate.downPerRound.toLocaleString('es-ES')} B` },
            { label: 'Subida por ronda', value: `${estimate.upPerRound.toLocaleString('es-ES')} B` },
          ]}
          outputs={[
            { label: 'Bytes por ronda', value: formatBytes(estimate.perRound) },
            { label: 'Total', value: `${formatBytes(estimate.total)} (${estimate.total.toLocaleString('es-ES')} B)` },
          ]}
          assumptions={['Solo se cuenta la carga útil de parámetros.', 'Todos los clientes seleccionados completan la ronda (sin abandonos).', 'En la simulación B, todas las configuraciones usan los mismos datos y la misma semilla.']}
        />
      }
      prosCons={{
        benefits: ['Más épocas locales pueden reducir drásticamente el número de rondas.', 'La participación parcial abarata cada ronda y tolera clientes no disponibles.', 'La comunicación escala con el tamaño del modelo, no con el de los datos.'],
        limitations: ['Para modelos grandes la comunicación puede superar al volumen de los propios datos.', 'Más cómputo local exige dispositivos capaces y aumenta la deriva con datos Non-IID.', 'Los costes reales de red son mayores y más variables que este modelo.'],
      }}
      reflection={{
        question: 'Una red de 1 000 móviles con conexiones lentas quiere entrenar un modelo de 11 millones de parámetros. ¿Qué parámetros ajustarías para que sea viable y qué precio pagarías por ello?',
        hint: 'Combina la estimación A (tamaño de modelo, participación, cuantización) con lo observado en B sobre épocas locales y rondas.',
      }}
    />
  );
}
