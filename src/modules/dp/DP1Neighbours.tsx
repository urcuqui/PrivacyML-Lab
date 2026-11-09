import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Plus, Trash2, UserX, Replace } from 'lucide-react';
import { ExperimentLayout, VisualCard } from '@/components/lab/ExperimentLayout';
import { ConfigSection, ParamChoice } from '@/components/lab/ParamControl';
import { Callout, ErrorList, ShowCalculations, StatTile } from '@/components/lab/Blocks';
import { RunTimeline } from '@/components/lab/RunTimeline';
import { Term } from '@/components/lab/Term';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { usePersistentState } from '@/lib/store';
import { useRuns } from '@/lib/runs';
import { cn } from '@/lib/utils';
import { f } from './common';

const ID = 'dp1';
const TITLE = '¿Por qué necesitamos privacidad?';

interface Person {
  name: string;
  age: number;
  s: 0 | 1;
}
type Query = 'count' | 'meanAge' | 'proportion';
type Op = 'remove' | 'replace';

interface Params {
  rows: Person[];
  target: number;
  query: Query;
  op: Op;
  replAge: number;
  replS: 0 | 1;
}

const DEFAULT_ROWS: Person[] = [
  { name: 'A', age: 22, s: 1 },
  { name: 'B', age: 25, s: 0 },
  { name: 'C', age: 29, s: 1 },
  { name: 'D', age: 34, s: 1 },
  { name: 'E', age: 41, s: 0 },
];
const DEFAULTS: Params = { rows: DEFAULT_ROWS, target: 3, query: 'count', op: 'remove', replAge: 30, replS: 0 };

const QUERY_LABEL: Record<Query, string> = {
  count: 'Conteo: nº de personas con atributo sensible = 1',
  meanAge: 'Media de edad',
  proportion: 'Proporción con atributo sensible = 1',
};

function evalQuery(q: Query, rows: Person[]): number {
  if (!rows.length) return NaN;
  if (q === 'count') return rows.filter((r) => r.s === 1).length;
  if (q === 'meanAge') return rows.reduce((a, r) => a + r.age, 0) / rows.length;
  return rows.filter((r) => r.s === 1).length / rows.length;
}

function DatasetTable({ title, rows, highlight, highlightKind }: { title: string; rows: Person[]; highlight: number | null; highlightKind: 'target' | 'new' }) {
  return (
    <div className="min-w-0 flex-1">
      <h4 className="mb-1 text-xs font-semibold">{title}</h4>
      <table className="w-full text-xs">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            <th scope="col" className="py-1 text-left font-medium">Persona</th>
            <th scope="col" className="py-1 text-right font-medium">Edad</th>
            <th scope="col" className="py-1 text-right font-medium">Sensible</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {rows.map((r, i) => (
              <motion.tr
                key={`${r.name}-${i}-${r.age}-${r.s}`}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className={cn('border-b last:border-0', highlight === i && (highlightKind === 'target' ? 'bg-dp/10 font-semibold' : 'bg-warn/15 font-semibold'))}
              >
                <td className="py-1">{r.name}</td>
                <td className="num py-1 text-right">{r.age}</td>
                <td className="num py-1 text-right">{r.s}</td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">(conjunto vacío)</p>}
    </div>
  );
}

export default function DP1Neighbours() {
  const [p, setP, reset] = usePersistentState<Params>(`${ID}.params`, DEFAULTS);
  const { addRun } = useRuns(ID);
  const set = (patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch }));

  const errors = useMemo(() => {
    const e: string[] = [];
    if (p.rows.length < 2) e.push('El conjunto de datos necesita al menos 2 personas.');
    if (p.rows.length > 12) e.push('Máximo 12 personas en este experimento.');
    if (p.rows.some((r) => !Number.isFinite(r.age) || r.age < 0 || r.age > 120)) e.push('Las edades deben estar entre 0 y 120.');
    if (p.target < 0 || p.target >= p.rows.length) e.push('Selecciona una persona objetivo válida.');
    if (p.op === 'replace' && (p.replAge < 0 || p.replAge > 120)) e.push('La edad de reemplazo debe estar entre 0 y 120.');
    return e;
  }, [p]);

  const target = p.rows[p.target];
  const neighbour: Person[] = useMemo(() => {
    if (!target) return p.rows;
    if (p.op === 'remove') return p.rows.filter((_, i) => i !== p.target);
    return p.rows.map((r, i) => (i === p.target ? { name: `${r.name}′`, age: p.replAge, s: p.replS } : r));
  }, [p, target]);

  const fD = evalQuery(p.query, p.rows);
  const fDp = evalQuery(p.query, neighbour);
  const diff = fD - fDp;
  const digits = p.query === 'count' ? 0 : 4;

  const updateRow = (i: number, patch: Partial<Person>) => set({ rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addRow = () => {
    const name = String.fromCharCode(65 + p.rows.length);
    set({ rows: [...p.rows, { name, age: 30, s: 0 }] });
  };
  const removeRow = (i: number) => set({ rows: p.rows.filter((_, j) => j !== i), target: p.target === i ? 0 : p.target > i ? p.target - 1 : p.target });

  const record = () => {
    if (errors.length || !target) return;
    addRun({
      experimentTitle: TITLE,
      seed: null,
      params: {
        Consulta: QUERY_LABEL[p.query],
        'Persona objetivo': target.name,
        Operación: p.op === 'remove' ? 'Eliminar' : `Reemplazar por (edad ${p.replAge}, sensible ${p.replS})`,
        'Tamaño de D': p.rows.length,
        'Datos (edad:sensible)': p.rows.map((r) => `${r.name}=${r.age}:${r.s}`).join(' '),
      },
      results: { 'f(D)': fD, "f(D′)": fDp, "Diferencia f(D) − f(D′)": diff },
      assumptions: ['Consulta exacta, sin ruido.', 'D y D′ difieren solo en la persona objetivo.'],
      limitations: ['No se aplica ningún mecanismo de privacidad: el resultado exacto se publica tal cual.', 'Observar la diferencia no prueba por sí solo la pertenencia o el atributo; depende del conocimiento adicional del observador.'],
      privacyGuarantee: null,
    });
  };

  return (
    <ExperimentLayout
      experimentId={ID}
      module="dp"
      kicker="Experimento 1"
      title={TITLE}
      objective="Observar cómo la contribución de una sola persona puede influir en una estadística publicada, y formular el problema que la Privacidad Diferencial intenta resolver."
      badges={['real', 'concept']}
      intro={
        <>
          <p>
            Imagina que una clínica publica «3 de nuestros 5 pacientes tienen el atributo sensible». Al día siguiente, la persona D se da de baja y la clínica publica «2 de 4». Alguien que sepa que D fue la única
            baja podría combinar ambas cifras y deducir que D tenía el atributo. Ninguna de las dos estadísticas nombra a D; es la <em>diferencia</em> entre publicaciones, junto con conocimiento externo, lo que
            puede revelar información.
          </p>
          <p>
            Para estudiar esto formalmente hablamos de <Term k="neighbouring">conjuntos vecinos</Term>: D y D′ son idénticos salvo por una persona (eliminada o reemplazada). Si el resultado de una consulta
            cambia de forma visible entre D y D′, el resultado lleva «huella» de esa persona.
          </p>
          <p className="font-medium">Pregunta central: ¿cómo podemos publicar información estadística útil limitando lo que se puede aprender sobre cualquier persona individual?</p>
        </>
      }
      config={
        <>
          <ConfigSection title="Conjunto de datos D (ficticio)">
            <table className="w-full text-xs">
              <caption className="sr-only">Editar conjunto de datos</caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="text-left font-medium">Persona</th>
                  <th scope="col" className="text-left font-medium">Edad</th>
                  <th scope="col" className="text-left font-medium">Sensible</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-0.5 font-medium">{r.name}</td>
                    <td className="py-0.5 pr-1">
                      <Input aria-label={`Edad de ${r.name}`} className="h-7 num text-xs" type="number" min={0} max={120} value={r.age} onChange={(e) => updateRow(i, { age: Number(e.target.value) })} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <NativeSelect aria-label={`Atributo sensible de ${r.name}`} className="h-7 text-xs" value={r.s} onChange={(e) => updateRow(i, { s: Number(e.target.value) as 0 | 1 })}>
                        <option value={0}>0</option>
                        <option value={1}>1</option>
                      </NativeSelect>
                    </td>
                    <td>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Eliminar fila ${r.name}`} disabled={p.rows.length <= 2} onClick={() => removeRow(i)}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button size="sm" variant="outline" onClick={addRow} disabled={p.rows.length >= 12}>
              <Plus /> Añadir persona
            </Button>
          </ConfigSection>
          <ConfigSection title="Consulta y vecino">
            <div className="space-y-1">
              <label htmlFor="dp1-query" className="text-xs font-medium">Consulta</label>
              <NativeSelect id="dp1-query" value={p.query} onChange={(e) => set({ query: e.target.value as Query })}>
                {(Object.keys(QUERY_LABEL) as Query[]).map((q) => (
                  <option key={q} value={q}>{QUERY_LABEL[q]}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor="dp1-target" className="text-xs font-medium">Persona objetivo</label>
              <NativeSelect id="dp1-target" value={p.target} onChange={(e) => set({ target: Number(e.target.value) })}>
                {p.rows.map((r, i) => (
                  <option key={i} value={i}>{r.name} (edad {r.age}, sensible {r.s})</option>
                ))}
              </NativeSelect>
            </div>
            <ParamChoice<Op> label="Cómo construir D′" value={p.op} options={['remove', 'replace']} format={(o) => (o === 'remove' ? 'Eliminar' : 'Reemplazar')} onChange={(op) => set({ op })} help="Eliminar = vecindad «añadir/eliminar»; reemplazar = vecindad «reemplazo» (n no cambia)." />
            {p.op === 'replace' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="dp1-ra" className="text-xs font-medium">Edad sustituta</label>
                  <Input id="dp1-ra" className="h-7 num text-xs" type="number" value={p.replAge} onChange={(e) => set({ replAge: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <label htmlFor="dp1-rs" className="text-xs font-medium">Sensible sustituto</label>
                  <NativeSelect id="dp1-rs" className="h-7 text-xs" value={p.replS} onChange={(e) => set({ replS: Number(e.target.value) as 0 | 1 })}>
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                  </NativeSelect>
                </div>
              </div>
            )}
          </ConfigSection>
          <ErrorList errors={errors} />
          <Button variant="dp" className="w-full" disabled={errors.length > 0} onClick={record}>
            <Play /> Ejecutar y registrar
          </Button>
        </>
      }
      visual={
        <>
          <VisualCard title="Conjuntos de datos vecinos, lado a lado" description="La fila resaltada es la única diferencia entre D y D′.">
            <div className="flex flex-col gap-4 sm:flex-row">
              <DatasetTable title={`D (n = ${p.rows.length})`} rows={p.rows} highlight={p.target} highlightKind="target" />
              <div className="flex items-center justify-center text-muted-foreground" aria-hidden>
                {p.op === 'remove' ? <UserX className="h-5 w-5" /> : <Replace className="h-5 w-5" />}
              </div>
              <DatasetTable title={`D′ (n = ${neighbour.length})`} rows={neighbour} highlight={p.op === 'replace' ? p.target : null} highlightKind="new" />
            </div>
          </VisualCard>
          <VisualCard title="Resultado exacto de la consulta" description={QUERY_LABEL[p.query]}>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="f(D)" value={f(fD, digits)} />
              <StatTile label="f(D′)" value={f(fDp, digits)} />
              <motion.div key={diff} initial={{ scale: 0.95, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }}>
                <StatTile label="Diferencia f(D) − f(D′)" value={f(diff, digits)} tone={diff !== 0 ? 'warn' : 'ok'} sub={diff !== 0 ? 'El resultado depende de la persona objetivo' : 'Sin diferencia en esta consulta'} />
              </motion.div>
            </div>
          </VisualCard>
        </>
      }
      observations={
        <>
          <Callout kind={diff !== 0 ? 'warn' : 'info'} title={diff !== 0 ? 'La contribución individual es visible' : 'Esta vez no hay diferencia'}>
            {diff !== 0 ? (
              <>Publicar f(D) y f(D′) de forma exacta deja ver un cambio de {f(Math.abs(diff), digits)}. Un observador con conocimiento adicional (por ejemplo, saber que {target?.name} es la única diferencia) podría usarlo para inferir algo sobre {target?.name}.</>
            ) : (
              <>Para esta consulta y esta persona el resultado no cambia. Pero otra persona u otra consulta sí podría producir diferencias: no se puede razonar persona a persona, hace falta una garantía para TODOS.</>
            )}
          </Callout>
          <Callout kind="info" title="Lo que NO significa">
            Observar una diferencia no demuestra automáticamente que alguien pertenezca al conjunto ni cuál es su atributo: el observador necesita saber cómo difieren exactamente las publicaciones, y en la práctica suele haber
            incertidumbre. El riesgo existe, pero su magnitud depende del conocimiento externo.
          </Callout>
          <p className="text-[13px] leading-relaxed">
            La <Term k="sensitivity">sensibilidad</Term> de una consulta es el mayor cambio posible entre vecinos. Para el conteo, es 1. En el próximo experimento añadiremos ruido calibrado a esa sensibilidad.
          </p>
        </>
      }
      timeline={<RunTimeline experimentId={ID} onReset={reset} />}
      details={
        <ShowCalculations
          equations={[
            p.query === 'count' ? 'f(D) = Σᵢ 1[sensibleᵢ = 1]' : p.query === 'meanAge' ? 'f(D) = (1/n) Σᵢ edadᵢ' : 'f(D) = (1/n) Σᵢ 1[sensibleᵢ = 1]',
            `Diferencia = f(D) − f(D′) = ${f(fD, 4)} − ${f(fDp, 4)} = ${f(diff, 4)}`,
          ]}
          inputs={[
            { label: 'n en D', value: p.rows.length },
            { label: 'n en D′', value: neighbour.length },
            { label: 'Persona objetivo', value: target ? `${target.name} (edad ${target.age}, sensible ${target.s})` : '—' },
          ]}
          outputs={[
            { label: 'f(D)', value: f(fD, 4) },
            { label: 'f(D′)', value: f(fDp, 4) },
            { label: '|f(D) − f(D′)|', value: f(Math.abs(diff), 4) },
          ]}
          assumptions={['Las consultas son exactas (sin ruido).', 'D′ se obtiene eliminando o reemplazando a una única persona.', 'Los datos son ficticios.']}
        />
      }
      prosCons={{
        benefits: ['Las estadísticas exactas tienen máxima utilidad (error cero).', 'Agregar (contar, promediar) oculta los registros individuales a simple vista.'],
        limitations: [
          'Agregar no basta: publicaciones sucesivas o consultas solapadas permiten ataques de diferenciación.',
          'La «anonimización» por eliminación de nombres no protege frente a observadores con información auxiliar.',
          'Razonar caso a caso no da garantías: hace falta una definición que cubra a todas las personas y a todos los observadores.',
        ],
      }}
      reflection={{
        question: 'Cambia la consulta a «Media de edad» y añade más personas. ¿Cómo cambia la diferencia entre D y D′ cuando n crece? ¿Qué implica para la cantidad de ruido que haría falta para ocultar a una persona?',
        hint: 'Para la media, la influencia de una persona es aproximadamente (rango de valores)/n: disminuye cuando n crece. Para el conteo, la influencia es 1 independientemente de n.',
      }}
    />
  );
}
