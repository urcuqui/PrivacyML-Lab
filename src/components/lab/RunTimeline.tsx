import { useState } from 'react';
import { History, Star, Trash2, RotateCcw, GitCompareArrows, Pencil, Check, Download, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRuns, type ExperimentRun, type ResultValue } from '@/lib/runs';
import { downloadFile, cn } from '@/lib/utils';
import { runsToJson } from '@/lib/report';

export function fmtResult(v: ResultValue): string {
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('es-ES') : v.toLocaleString('es-ES', { maximumFractionDigits: 4 });
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (v === null) return '—';
  return v;
}

/** Tabla comparativa de varias ejecuciones (parámetros y resultados). */
export function RunComparisonTable({ runs }: { runs: ExperimentRun[] }) {
  if (runs.length === 0) return null;
  const paramKeys = [...new Set(runs.flatMap((r) => Object.keys(r.params)))];
  const resultKeys = [...new Set(runs.flatMap((r) => Object.keys(r.results)))];
  const differs = (k: string, src: 'params' | 'results') => new Set(runs.map((r) => JSON.stringify(r[src][k]))).size > 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <caption className="sr-only">Comparación de ejecuciones</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-1.5 pr-3 text-left font-medium text-muted-foreground">
              Campo
            </th>
            {runs.map((r) => (
              <th key={r.id} scope="col" className="px-2 py-1.5 text-right font-semibold">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="bg-muted/50">
            <th colSpan={runs.length + 1} scope="colgroup" className="py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Parámetros
            </th>
          </tr>
          <tr className="border-b">
            <th scope="row" className="py-1 pr-3 text-left font-normal">
              Semilla
            </th>
            {runs.map((r) => (
              <td key={r.id} className="num px-2 py-1 text-right">
                {r.seed ?? '—'}
              </td>
            ))}
          </tr>
          {paramKeys.map((k) => (
            <tr key={k} className={cn('border-b', differs(k, 'params') && 'bg-warn/10')}>
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                {k}
              </th>
              {runs.map((r) => (
                <td key={r.id} className="num px-2 py-1 text-right">
                  {fmtResult(r.params[k] ?? null)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="bg-muted/50">
            <th colSpan={runs.length + 1} scope="colgroup" className="py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Resultados
            </th>
          </tr>
          {resultKeys.map((k) => (
            <tr key={k} className="border-b">
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                {k}
              </th>
              {runs.map((r) => (
                <td key={r.id} className="num px-2 py-1 text-right">
                  {fmtResult(r.results[k] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">Las filas resaltadas indican parámetros que difieren entre ejecuciones.</p>
    </div>
  );
}

/**
 * Panel inferior — Línea temporal del experimento.
 * Permite inspeccionar ejecuciones anteriores, reproducirlas (restaurar parámetros), compararlas,
 * renombrarlas, guardarlas en el historial y exportarlas.
 */
export function RunTimeline({ experimentId, onRestore, onReset }: { experimentId: string; onRestore?: (run: ExperimentRun) => void; onReset?: () => void }) {
  const { runs, updateRun, removeRun, clearUnsaved } = useRuns(experimentId);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const sel = runs.filter((r) => selected.includes(r.id));
  return (
    <section aria-label="Línea temporal del experimento" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden /> Línea temporal del experimento
          <span className="text-xs font-normal text-muted-foreground">({runs.length} ejecuciones)</span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {onReset && (
            <Button size="sm" variant="outline" onClick={onReset}>
              <RotateCcw /> Restablecer parámetros
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!sel.length} onClick={() => downloadFile(`${experimentId}-ejecuciones.json`, runsToJson(sel))}>
            <Download /> Exportar JSON
          </Button>
          <Button size="sm" variant="ghost" disabled={!runs.some((r) => !r.saved)} onClick={() => { clearUnsaved(); setSelected([]); }}>
            <Eraser /> Borrar no guardadas
          </Button>
        </div>
      </div>
      <div className="p-4">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay ejecuciones. Configura los parámetros y pulsa «Ejecutar»: cada ejecución quedará registrada aquí para reproducirla o compararla.</p>
        ) : (
          <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="Ejecuciones">
            {runs.map((r, i) => (
              <li key={r.id} className={cn('min-w-[210px] max-w-[240px] shrink-0 rounded-md border p-2.5 text-xs', selected.includes(r.id) && 'border-primary ring-1 ring-primary')}>
                <div className="flex items-center justify-between gap-1">
                  {editing === r.id ? (
                    <form
                      className="flex w-full gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (draft.trim()) updateRun(r.id, { name: draft.trim() });
                        setEditing(null);
                      }}
                    >
                      <Input autoFocus aria-label="Nuevo nombre" className="h-6 text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} />
                      <Button size="icon" variant="ghost" className="h-6 w-6" type="submit" aria-label="Confirmar nombre">
                        <Check />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className="truncate font-semibold" title={r.name}>
                        <span className="mr-1 text-muted-foreground">#{i + 1}</span>
                        {r.name}
                      </span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Renombrar ${r.name}`} onClick={() => { setEditing(r.id); setDraft(r.name); }}>
                        <Pencil className="!size-3" />
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(r.createdAt).toLocaleTimeString('es-ES')} · semilla {r.seed ?? '—'}
                </p>
                <dl className="mt-1 space-y-0.5">
                  {Object.entries(r.results)
                    .slice(0, 3)
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="truncate text-muted-foreground" title={k}>
                          {k}
                        </dt>
                        <dd className="num">{fmtResult(v)}</dd>
                      </div>
                    ))}
                </dl>
                <div className="mt-2 flex gap-1">
                  <Button size="icon" variant={selected.includes(r.id) ? 'default' : 'outline'} className="h-7 w-7" aria-pressed={selected.includes(r.id)} aria-label={`Seleccionar ${r.name} para comparar`} title="Comparar" onClick={() => toggle(r.id)}>
                    <GitCompareArrows />
                  </Button>
                  {onRestore && (
                    <Button size="icon" variant="outline" className="h-7 w-7" aria-label={`Restaurar parámetros de ${r.name}`} title="Restaurar parámetros (reproducir)" onClick={() => onRestore(r)}>
                      <RotateCcw />
                    </Button>
                  )}
                  <Button size="icon" variant={r.saved ? 'secondary' : 'outline'} className={cn('h-7 w-7', r.saved && 'text-warn')} aria-pressed={r.saved} aria-label={r.saved ? 'Quitar del historial' : 'Guardar en el historial'} title={r.saved ? 'Guardada en el historial' : 'Guardar en el historial'} onClick={() => updateRun(r.id, { saved: !r.saved })}>
                    <Star className={r.saved ? 'fill-current' : ''} />
                  </Button>
                  <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label={`Eliminar ${r.name}`} title="Eliminar" onClick={() => { removeRun(r.id); setSelected((s) => s.filter((x) => x !== r.id)); }}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {sel.length >= 1 && (
          <div className="mt-3 border-t pt-3">
            <h3 className="mb-2 text-xs font-semibold">{sel.length === 1 ? 'Detalle de la ejecución seleccionada' : `Comparación de ${sel.length} ejecuciones`}</h3>
            <RunComparisonTable runs={sel} />
          </div>
        )}
      </div>
    </section>
  );
}
