import { useMemo } from 'react';
import { Lock, Play, ShieldCheck, Cpu } from 'lucide-react';
import { CartesianGrid, Line, LineChart, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis, Legend } from 'recharts';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamSlider, ParamToggle, SeedControl } from '@/components/lab/ParamControl';
import { Callout, ErrorList, Formula, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { C, SERIES, axisProps, gridProps, legendProps, tooltipProps } from '@/components/charts/chartTheme';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { createSeededRng, deriveSeed } from '@/lib/rng/rng';
import { pearson, quantile } from '@/lib/stats';
import { DEFAULT_DATA_CONFIG, generateFederatedData, validateDataConfig, type FederatedDataConfig } from '@/lib/fl/data';
import { runFedAvg } from '@/lib/fl/fedavg';
import { gradientInversion } from '@/lib/fl/leakage';
import type { Vec } from '@/lib/vec';
import { ClientScatter, ParamVec, ScatterLegend, f, fromLabelled, pct, toLabelled } from './shared';

const ID = 'fl5';
const TITLE = 'Limitaciones de privacidad del Aprendizaje Federado';

interface Params {
  batchSize: number;
  noiseSd: number;
  batchIndex: number;
  numClients: number;
  classImbalance: number;
  secAgg: boolean;
  seed: number;
}
const DEFAULTS: Params = { batchSize: 1, noiseSd: 0, batchIndex: 0, numClients: 6, classImbalance: 0.9, secAgg: false, seed: 5 };
const LABELS: Record<keyof Params, string> = {
  batchSize: 'Tamaño de lote observado',
  noiseSd: 'Desv. del ruido gaussiano',
  batchIndex: 'Lote inspeccionado',
  numClients: 'Clientes (correlación)',
  classImbalance: 'Desequilibrio de clases',
  secAgg: 'Agregación segura (conceptual)',
  seed: 'Semilla',
};
const NOISE_GRID = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];

const corrCfg = (p: Params): FederatedDataConfig => ({ ...DEFAULT_DATA_CONFIG, numClients: p.numClients, samplesPerClient: 150, mode: 'non-iid', classImbalance: p.classImbalance, featureShift: 0, seed: p.seed });

function compute(p: Params) {
  // --- A. Inversión de gradiente sobre el cliente "Hospital Norte" ---
  const data = generateFederatedData({ ...DEFAULT_DATA_CONFIG, numClients: 3, samplesPerClient: 200, seed: p.seed });
  const warm = runFedAvg(data, { rounds: 2, localEpochs: 1, localLr: 0.1, batchSize: 16, participation: 1, seed: p.seed });
  const model: Vec = warm.finalParams;
  const client = data.clients[0];
  const order = createSeededRng(deriveSeed(p.seed, 'leak-batch', p.batchIndex)).shuffle(client.train);
  const batch = order.slice(0, Math.min(p.batchSize, order.length));
  const clean = gradientInversion(model, batch);
  const noisy = p.noiseSd > 0 ? gradientInversion(model, batch, { rng: createSeededRng(deriveSeed(p.seed, 'leak-noise', p.batchIndex, p.noiseSd)), sd: p.noiseSd }) : clean;
  const target = clean.estimate; // lo que el servidor recupera exactamente sin ruido
  const noisyErr = noisy.estimate && target ? Math.hypot(noisy.estimate[0] - target[0], noisy.estimate[1] - target[1]) : null;
  // Error mediano frente a la desviación del ruido (100 ensayos por nivel)
  const noiseCurve = NOISE_GRID.map((sd) => {
    if (!target) return { sd, error: NaN };
    const rng = createSeededRng(deriveSeed(p.seed, 'leak-curve', sd, p.batchIndex, p.batchSize));
    const errs = Array.from({ length: 100 }, () => {
      const r = sd > 0 ? gradientInversion(model, batch, { rng, sd }) : clean;
      return r.estimate ? Math.hypot(r.estimate[0] - target[0], r.estimate[1] - target[1]) : Infinity;
    });
    return { sd, error: quantile(errs, 0.5) };
  });

  // --- B. Correlación entre el sesgo de la actualización y la proporción de positivos ---
  const cData = generateFederatedData(corrCfg(p));
  const fed = runFedAvg(cData, { rounds: 3, localEpochs: 1, localLr: 0.1, batchSize: 16, participation: 1, seed: p.seed });
  const corr = fed.rounds.map((rt) => {
    const rates = rt.updates.map((u) => cData.clients[u.clientId].positiveRate);
    const db = rt.updates.map((u) => u.delta[2]);
    return { round: rt.round, r: pearson(rates, db), points: rt.updates.map((u, i) => ({ rate: rates[i], db: db[i], client: cData.clients[u.clientId].name })) };
  });

  // --- C. Máscaras por pares (ilustración conceptual de agregación segura) ---
  const r1 = fed.rounds[0];
  const K = r1.updates.length;
  const maskRng = createSeededRng(deriveSeed(p.seed, 'masks'));
  const masks: Vec[] = r1.updates.map(() => [0, 0, 0]);
  for (let i = 0; i < K; i++)
    for (let j = i + 1; j < K; j++) {
      const m = [maskRng.normal(0, 5), maskRng.normal(0, 5), maskRng.normal(0, 5)];
      for (let d = 0; d < 3; d++) {
        masks[i][d] += m[d];
        masks[j][d] -= m[d];
      }
    }
  const masked = r1.updates.map((u, i) => u.delta.map((v, d) => v + masks[i][d]));
  const sumTrue = [0, 1, 2].map((d) => r1.updates.reduce((s, u) => s + u.delta[d], 0));
  const sumMasked = [0, 1, 2].map((d) => masked.reduce((s, v) => s + v[d], 0));

  return { model, client, batch, clean, noisy, noisyErr, noiseCurve, cData, corr, r1, masked, sumTrue, sumMasked };
}

export default function FL5Leakage() {
  const [params, setParams, resetParams] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const { addRun } = useRuns(ID);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const errors = useMemo(() => validateDataConfig(corrCfg(params)), [params]);
  const res = useMemo(() => (errors.length ? null : compute(params)), [params, errors]);

  const record = () => {
    if (!res) return;
    addRun({
      experimentTitle: TITLE,
      seed: params.seed,
      params: toLabelled(params, LABELS),
      results: {
        'Estimación del servidor x̂₁': res.noisy.estimate?.[0] ?? null,
        'Estimación del servidor x̂₂': res.noisy.estimate?.[1] ?? null,
        'Error frente a la media real del lote': res.noisy.estimate ? Math.hypot(res.noisy.estimate[0] - res.clean.trueMean[0], res.noisy.estimate[1] - res.clean.trueMean[1]) : null,
        'Error frente a la estimación sin ruido': res.noisyErr,
        'Correlación sesgo-Δ / % positivos (ronda 1)': res.corr[0].r,
      },
      assumptions: ['Regresión logística con sesgo; el servidor conoce el modelo global enviado.', 'El servidor observa el gradiente medio de un lote de tamaño B de un cliente.', 'El ruido gaussiano añadido es ilustrativo (sin recorte ni contabilidad).'],
      limitations: ['Ilustración analítica en un modelo lineal, no un ataque de reconstrucción completo.', 'La agregación segura se muestra solo conceptualmente (máscaras reales, no un protocolo criptográfico).'],
      privacyGuarantee: null,
    });
  };

  const est = res?.noisy.estimate ?? null;
  const L = 5;
  const clampL = (v: number) => Math.max(-L, Math.min(L, v));
  const outOfView = est ? Math.abs(est[0]) > L || Math.abs(est[1]) > L : false;
  const corrPoints = res ? res.corr.map((c) => c.points) : [];

  return (
    <ExperimentLayout
      experimentId={ID}
      module="fl"
      kicker="Experimento 5"
      title={TITLE}
      objective="Comprobar que «los datos permanecen locales» no implica «el servidor no puede inferir nada», e identificar qué protege (y qué no) cada defensa: agregación segura, privacidad diferencial y entornos de ejecución confiables."
      badges={['real', 'concept']}
      intro={
        <>
          <p>
            El Hospital Norte nunca envía los biomarcadores de sus pacientes; solo envía una actualización del modelo. Pero esa actualización es una <em>función</em> de esos biomarcadores. En regresión logística, el gradiente de un único paciente es{' '}
            <span className="num">g = (p − y) · [x₁, x₂, 1]</span>: las dos primeras componentes son las características multiplicadas por un número, y la última es ese mismo número. Basta dividir para recuperar <span className="num">x = g_w / g_b</span> exactamente.
          </p>
          <p>
            Con lotes mayores, el cociente ya no da un paciente concreto, sino una media ponderada de los pacientes del lote. Y, entre clientes, la componente de sesgo de la actualización delata qué proporción de casos de riesgo alto tiene cada hospital.
          </p>
          <p>
            <strong>Esto es una ilustración analítica en un modelo lineal, no un ataque de reconstrucción completo.</strong> En redes profundas existen ataques (p. ej. inversión de gradientes) con éxito variable según el modelo y el tamaño del lote.
          </p>
        </>
      }
      config={
        <>
          <ConfigSection title="A · Lo que revela un gradiente">
            <ParamSlider label={<Term k="batchSize">Tamaño de lote observado (B)</Term>} ariaLabel="Tamaño de lote observado" value={params.batchSize} onChange={(v) => set('batchSize', Math.round(v))} min={1} max={64} step={1} help="B = 1: el servidor recupera exactamente al paciente." />
            <ParamSlider label="Lote inspeccionado" ariaLabel="Lote inspeccionado" value={params.batchIndex} onChange={(v) => set('batchIndex', Math.round(v))} min={0} max={50} step={1} help="Cambia qué pacientes forman el lote." />
            <ParamSlider
              label={<Term k="gaussian">Ruido gaussiano en la actualización</Term>}
              ariaLabel="Desviación del ruido gaussiano"
              value={params.noiseSd}
              onChange={(v) => set('noiseSd', v)}
              min={0}
              max={1}
              step={0.005}
              help="Desviación típica por coordenada añadida al gradiente medio. Solo ilustra cómo el ruido dificulta la inferencia: sin recorte, sin calibración a una sensibilidad y sin contabilidad NO es privacidad diferencial y no se muestra ningún ε."
            />
          </ConfigSection>
          <ConfigSection title="B · Inferencia entre clientes">
            <ParamSlider label="Número de clientes" ariaLabel="Número de clientes" value={params.numClients} onChange={(v) => set('numClients', Math.round(v))} min={3} max={10} step={1} />
            <ParamSlider label="Desequilibrio de clases" ariaLabel="Desequilibrio de clases" value={params.classImbalance} onChange={(v) => set('classImbalance', v)} min={0} max={1} step={0.05} />
          </ConfigSection>
          <ConfigSection title="C · Defensas">
            <ParamToggle label={<Term k="secureAggregation">Agregación segura (conceptual)</Term>} checked={params.secAgg} onChange={(v) => set('secAgg', v)} help="Muestra qué vería el servidor si cada actualización llegara enmascarada." />
            <SeedControl value={params.seed} onChange={(v) => set('seed', v)} />
          </ConfigSection>
          <ErrorList errors={errors} />
          <Button className="w-full" variant="fl" disabled={!res} onClick={record}>
            <Play /> Registrar ejecución
          </Button>
          <p className="text-[11px] text-muted-foreground">Los cálculos se actualizan al cambiar cada parámetro; el botón guarda la ejecución en la línea temporal.</p>
        </>
      }
      visual={
        res ? (
          <>
            <VisualCard title="A · ¿Qué puede calcular el servidor a partir de una actualización?" description={`Gradiente medio de ${res.batch.length} paciente(s) del ${res.client.name} con el modelo global actual (tras 2 rondas).`} actions={<IntegrityBadge kind="real" />}>
              <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
                <div>
                  <ClientScatter
                    samples={res.batch}
                    title={`Lote de ${res.batch.length} pacientes con la estimación del servidor`}
                    size={260}
                    L={L}
                    lines={[{ params: res.model, color: C.muted, label: 'Modelo global', dashed: true, width: 1 }]}
                    extra={(sx, sy) => (
                      <>
                        <g transform={`translate(${sx(res.clean.trueMean[0])},${sy(res.clean.trueMean[1])})`}>
                          <path d="M-5,-5 L5,5 M-5,5 L5,-5" stroke={C.fg} strokeWidth={2} />
                        </g>
                        {est && (
                          <g transform={`translate(${sx(clampL(est[0]))},${sy(clampL(est[1]))})`}>
                            <path d="M0,-8 L2.2,-2.6 L8,-2.4 L3.4,1.2 L5,7 L0,3.6 L-5,7 L-3.4,1.2 L-8,-2.4 L-2.2,-2.6 Z" fill={C.dp} stroke="hsl(var(--card))" strokeWidth={0.8} />
                          </g>
                        )}
                      </>
                    )}
                  />
                  <div className="mt-2 space-y-1">
                    <ScatterLegend />
                    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span>✕ media real del lote</span>
                      <span style={{ color: C.dp }}>★ estimación del servidor x̂ = g_w / g_b</span>
                    </div>
                    {outOfView && <p className="text-[11px] text-warn">La estimación cae fuera del área dibujada; se muestra en el borde.</p>}
                  </div>
                </div>
                <div className="space-y-3">
                  <Formula>
                    g = (1/B) Σ (p_i − y_i)·[x_i, 1] = <ParamVec v={res.noisy.gradient} digits={5} />
                  </Formula>
                  <Formula>
                    x̂ = (g_w₁ / g_b, g_w₂ / g_b) = {est ? <ParamVec v={est} /> : 'indefinido (g_b ≈ 0)'}
                  </Formula>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <caption className="sr-only">Comparación entre datos reales y estimación</caption>
                      <tbody>
                        {res.batch.length <= 6 &&
                          res.batch.map((s, i) => (
                            <tr key={i} className="border-b">
                              <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                                Paciente {i + 1} real (y = {s.y}, residuo {f(res.clean.residuals[i], 3)})
                              </th>
                              <td className="py-1 text-right"><ParamVec v={s.x} /></td>
                            </tr>
                          ))}
                        <tr className="border-b">
                          <th scope="row" className="py-1 text-left font-normal text-muted-foreground">Media real del lote</th>
                          <td className="py-1 text-right"><ParamVec v={res.clean.trueMean} /></td>
                        </tr>
                        <tr className="border-b">
                          <th scope="row" className="py-1 text-left font-normal text-muted-foreground">Media ponderada por residuos (lo que el cociente recupera sin ruido)</th>
                          <td className="py-1 text-right">{res.clean.residualWeightedMean ? <ParamVec v={res.clean.residualWeightedMean} /> : '—'}</td>
                        </tr>
                        <tr>
                          <th scope="row" className="py-1 text-left font-semibold">Estimación del servidor{params.noiseSd > 0 ? ' (con ruido)' : ''}</th>
                          <td className="py-1 text-right font-semibold">{est ? <ParamVec v={est} /> : '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {res.batch.length === 1 && params.noiseSd === 0 ? (
                    <Callout kind="danger" title="Recuperación exacta">
                      Con B = 1, el servidor recupera los biomarcadores del paciente sin error numérico apreciable. También conoce su etiqueta salvo en casos degenerados: el signo de g_b = p − y indica si y = 1 (negativo) o y = 0 (positivo).
                    </Callout>
                  ) : !res.clean.sameSignResiduals ? (
                    <Callout kind="info">Los residuos tienen signos distintos: el cociente puede caer fuera de la nube de pacientes. Aun así, es una función determinista de sus datos que revela información agregada.</Callout>
                  ) : (
                    <Callout kind="warn">Con B &gt; 1 el cociente es una media ponderada de los pacientes del lote: no identifica a uno concreto, pero sí revela características agregadas del lote.</Callout>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <ChartFrame
                  title="Efecto del ruido sobre la inferencia"
                  description="Error mediano (100 ensayos por nivel) entre la estimación con ruido y la que el servidor obtendría sin ruido, para el lote actual."
                  height={200}
                  data={res.noiseCurve}
                  columns={[
                    { key: 'sd', label: 'Desv. del ruido' },
                    { key: 'error', label: 'Error mediano', format: (v) => f(v as number, 4) },
                  ]}
                >
                  <LineChart data={res.noiseCurve.filter((d) => d.sd > 0 && Number.isFinite(d.error))} margin={{ top: 5, right: 12, left: -6, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="sd" {...axisProps} scale="log" domain={['auto', 'auto']} type="number" tickFormatter={(v) => f(v as number, 3)} />
                    <YAxis {...axisProps} scale="log" domain={['auto', 'auto']} tickFormatter={(v) => f(v as number, 2)} allowDataOverflow />
                    <RTooltip {...tooltipProps} formatter={(v) => f(v as number, 4)} labelFormatter={(l) => `σ = ${f(l as number, 3)}`} />
                    <Line dataKey="error" name="Error mediano" stroke={C.dp} strokeWidth={2} />
                  </LineChart>
                </ChartFrame>
              </div>
            </VisualCard>

            <VisualCard title="B · Inferencia de propiedades de cada cliente" description="Ronda 1 a 3 de FedAvg con clientes Non-IID (solo desequilibrio de clases). El servidor solo ve las actualizaciones Δ_k." actions={<IntegrityBadge kind="empirical" />}>
              <ChartFrame
                title="Componente de sesgo de Δ_k frente a la proporción de positivos del cliente"
                description="Cada punto es un cliente en una ronda. Una relación clara indica que el servidor puede estimar la proporción de casos de riesgo alto de cada hospital a partir de su actualización."
                height={240}
                data={corrPoints.flatMap((pts, i) => pts.map((pt) => ({ ronda: i + 1, cliente: pt.client, rate: pt.rate, db: pt.db })))}
                columns={[
                  { key: 'ronda', label: 'Ronda' },
                  { key: 'cliente', label: 'Cliente', format: (v) => String(v) },
                  { key: 'rate', label: '% positivos', format: (v) => pct(v as number) },
                  { key: 'db', label: 'Δ sesgo', format: (v) => f(v as number, 4) },
                ]}
              >
                <ScatterChart margin={{ top: 5, right: 12, left: -6, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="rate" type="number" name="% positivos" {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${Math.round((v as number) * 100)}%`} />
                  <YAxis dataKey="db" type="number" name="Δ sesgo" {...axisProps} tickFormatter={(v) => f(v as number, 2)} />
                  <ZAxis range={[50, 50]} />
                  <RTooltip {...tooltipProps} formatter={(v, n) => (n === '% positivos' ? pct(v as number) : f(v as number, 4))} />
                  <Legend {...legendProps} />
                  {corrPoints.map((pts, i) => (
                    <Scatter key={i} name={`Ronda ${i + 1}`} data={pts} fill={SERIES[i]} />
                  ))}
                </ScatterChart>
              </ChartFrame>
              <div className="mt-2 flex flex-wrap gap-2">
                {res.corr.map((c) => (
                  <StatTile key={c.round} label={`Correlación de Pearson, ronda ${c.round}`} value={f(c.r, 3)} />
                ))}
              </div>
            </VisualCard>

            <VisualCard title="C · ¿Qué ve el servidor? (ronda 1)" description={params.secAgg ? 'Con agregación segura (conceptual): cada actualización llega enmascarada; las máscaras se cancelan en la suma.' : 'Sin agregación segura: el servidor ve cada actualización individual.'} actions={<IntegrityBadge kind="concept" />}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th scope="col" className="py-1 text-left font-medium">Cliente</th>
                      <th scope="col" className="py-1 text-right font-medium">Δ_k real (solo lo conoce el cliente)</th>
                      <th scope="col" className="py-1 text-right font-medium">Lo que recibe el servidor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.r1.updates.map((u, i) => (
                      <tr key={u.clientId} className="border-b">
                        <th scope="row" className="py-1 text-left font-normal">{res.cData.clients[u.clientId].name}</th>
                        <td className="py-1 text-right"><ParamVec v={u.delta} /></td>
                        <td className="py-1 text-right">{params.secAgg ? <ParamVec v={res.masked[i]} className="text-dp" /> : <ParamVec v={u.delta} className="text-destructive" />}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row" className="py-1 text-left font-semibold">Suma Σ Δ_k</th>
                      <td className="py-1 text-right"><ParamVec v={res.sumTrue} /></td>
                      <td className="py-1 text-right font-semibold"><ParamVec v={params.secAgg ? res.sumMasked : res.sumTrue} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {params.secAgg
                  ? 'Cada par de clientes (i, j) comparte una máscara aleatoria r_ij: i suma r_ij y j la resta. Individualmente los vectores parecen ruido, pero la suma coincide con la real (salvo redondeo). El servidor deja de ver cada actualización individual, pero sigue viendo la suma y el modelo resultante: lo que estos revelen no queda protegido.'
                  : 'Activa «Agregación segura (conceptual)» para ver cómo las máscaras por pares ocultan cada actualización individual sin cambiar la suma.'}
              </p>
              <Callout kind="warn" className="mt-2" title="No es un protocolo criptográfico">
                Esta tabla usa máscaras reales generadas con un PRNG con semilla. Un protocolo real (p. ej. Bonawitz et al., 2017) usa aritmética modular, acuerdo de claves entre clientes y reparto de secretos para tolerar abandonos. Nada de eso está implementado.
              </Callout>
            </VisualCard>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  Icon: Lock,
                  title: 'Agregación segura',
                  protects: 'Oculta al servidor cada actualización individual: solo ve la suma de un grupo suficientemente grande de clientes. Combinada con ruido distribuido entre clientes, reduce la confianza necesaria en el servidor.',
                  not: 'No protege lo que revela la suma ni el modelo final; con pocos clientes, o si el servidor manipula la participación, la suma puede aislar a uno. No limita la memorización.',
                },
                {
                  Icon: ShieldCheck,
                  title: 'Privacidad diferencial',
                  protects: 'Con recorte + ruido calibrado y un contador válido, acota formalmente cuánto influye una unidad (registro o cliente) en lo que se publica, incluido el modelo final.',
                  not: 'Con DP central el servidor recibe y ve cada actualización individual ANTES de añadir el ruido: la garantía protege frente a quien observa los modelos publicados, no frente al servidor. Reduce utilidad. Depende de la unidad elegida, de la vecindad, de los supuestos y de la contabilidad.',
                },
                {
                  Icon: Cpu,
                  title: 'Ejecución confiable y controles de acceso',
                  protects: 'Entornos de ejecución confiables (TEE), auditoría y control de acceso limitan quién puede ver las actualizaciones y qué código las procesa.',
                  not: 'Dependen de la confianza en el hardware y en los operadores; existen ataques de canal lateral. No limitan lo que revela el modelo publicado.',
                },
              ].map((d) => (
                <div key={d.title} className="rounded-lg border bg-card p-4 text-[13px] leading-relaxed">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <d.Icon className="h-4 w-4 text-fl" aria-hidden /> {d.title}
                  </h3>
                  <p>
                    <strong className="text-ok">Protege:</strong> {d.protects}
                  </p>
                  <p className="mt-1">
                    <strong className="text-warn">No protege:</strong> {d.not}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <ErrorList errors={errors} />
        )
      }
      observations={
        res ? (
          <>
            <Callout kind="danger" title="«Los datos permanecen locales» ≠ «el servidor no puede inferir nada»">
              Las actualizaciones son funciones deterministas de los datos locales.
            </Callout>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Tamaño de lote B" value={res.batch.length} />
              <StatTile label="Error vs media real" value={est ? f(Math.hypot(est[0] - res.clean.trueMean[0], est[1] - res.clean.trueMean[1]), 4) : '—'} tone={res.batch.length === 1 && params.noiseSd === 0 ? 'warn' : undefined} />
              <StatTile label="Error causado por el ruido" value={params.noiseSd > 0 ? f(res.noisyErr, 4) : '0'} sub="vs estimación sin ruido" tone="dp" />
              <StatTile label="Correlación (ronda 1)" value={f(res.corr[0].r, 3)} sub="Δ sesgo vs % positivos" />
            </div>
            <p className="text-[13px] leading-relaxed">
              {Math.abs(res.corr[0].r) > 0.7
                ? 'La componente de sesgo de cada actualización está fuertemente correlacionada con la proporción de casos de riesgo alto de cada hospital: el servidor puede inferir una propiedad de cada cliente sin ver sus datos.'
                : 'Con esta configuración la correlación es débil; prueba a aumentar el desequilibrio de clases.'}
            </p>
            <Callout kind="info" title="Sugerencia">
              Sube el ruido y observa cómo crece el error de la estimación: es la intuición detrás de DP. Pero una garantía formal exige recortar las contribuciones y contabilizar el presupuesto (Módulo 3).
            </Callout>
          </>
        ) : null
      }
      timeline={<RunTimeline experimentId={ID} onRestore={(r) => setParams(fromLabelled(r.params, LABELS, DEFAULTS))} onReset={resetParams} />}
      details={
        res ? (
          <ShowCalculations
            equations={[
              'Gradiente por ejemplo: ∇ℓ = (σ(wᵀx + b) − y) · [x₁, x₂, 1] = r · [x₁, x₂, 1]',
              'Gradiente medio: g = (1/B) Σ r_i [x_i, 1]  ⇒  g_w / g_b = Σ r_i x_i / Σ r_i',
              'Con ruido: g̃ = g + N(0, σ²I)',
              'Máscaras: m_i = Σ_{j>i} r_ij − Σ_{j<i} r_ji  ⇒  Σ_i (Δ_i + m_i) = Σ_i Δ_i',
            ]}
            inputs={[
              { label: 'Modelo global (w₁, w₂, b)', value: `[${res.model.map((v) => f(v, 4)).join(', ')}]` },
              { label: 'B', value: res.batch.length },
              { label: 'σ del ruido', value: params.noiseSd },
            ]}
            intermediates={[
              { label: 'Σ r_i', value: f(res.clean.residuals.reduce((a, b) => a + b, 0), 5) },
              { label: 'g (sin ruido)', value: `[${res.clean.gradient.map((v) => f(v, 5)).join(', ')}]` },
              { label: 'Residuos del mismo signo', value: res.clean.sameSignResiduals ? 'sí' : 'no' },
            ]}
            outputs={[
              { label: 'x̂ servidor', value: est ? `[${est.map((v) => f(v, 4)).join(', ')}]` : '—' },
              { label: 'Media real', value: `[${res.clean.trueMean.map((v) => f(v, 4)).join(', ')}]` },
              ...res.corr.map((c) => ({ label: `Pearson ronda ${c.round}`, value: f(c.r, 4) })),
            ]}
            assumptions={['El servidor conoce el modelo que envió y observa el gradiente medio (o Δ con un solo paso local).', 'Con varios pasos locales la relación se complica, pero la actualización sigue dependiendo de los datos.', 'Ilustración en un modelo lineal; no representa la eficacia de ataques en redes profundas.']}
          />
        ) : null
      }
      prosCons={{
        benefits: ['Mantener los datos en local reduce riesgos de una base centralizada (brechas masivas, usos secundarios).', 'FL se combina bien con defensas adicionales: agregación segura, DP y TEE.'],
        limitations: ['Las actualizaciones individuales pueden revelar datos o propiedades de los clientes.', 'La agregación segura no protege el agregado ni el modelo final.', 'El ruido reduce la inferencia, pero sin recorte y contabilidad no ofrece garantía formal.'],
      }}
      reflection={{
        question: 'Un consorcio afirma: «Nuestro sistema es privado porque usa aprendizaje federado». ¿Qué preguntas le harías para evaluar esa afirmación?',
        hint: '¿Quién ve las actualizaciones individuales? ¿Cuántos clientes participan por ronda? ¿Se aplica DP, a qué unidad y con qué ε calculado? ¿Qué se publica al final?',
      }}
    />
  );
}
