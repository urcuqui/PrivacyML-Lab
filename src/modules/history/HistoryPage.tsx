import { useState } from 'react';
import { Download, FileText, Star, Trash2, Pencil, Check, GitCompareArrows, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/lab/Blocks';
import { RunComparisonTable } from '@/components/lab/RunTimeline';
import { useAllRuns } from '@/lib/runs';
import { buildReport, runsToJson } from '@/lib/report';
import { downloadFile, cn } from '@/lib/utils';
import { href } from '@/lib/router';
import { experimentById } from '@/modules/registry';

export default function HistoryPage() {
  const [all, setAll] = useAllRuns();
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const runs = all.filter((r) => showAll || r.saved).sort((a, b) => b.createdAt - a.createdAt);
  const sel = runs.filter((r) => selected.includes(r.id));
  const update = (id: string, patch: Partial<(typeof all)[number]>) => setAll((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const exportTarget = sel.length ? sel : runs;
  return (
    <div className="space-y-4">
      <header className="rounded-lg border bg-card p-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Archive className="h-6 w-6 text-primary" aria-hidden /> Historial de experimentos
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Las ejecuciones se guardan solo en el almacenamiento local de tu navegador (localStorage). Marca con <Star className="inline h-3.5 w-3.5" aria-label="estrella" /> las ejecuciones que quieras conservar desde la línea temporal de cada experimento. Puedes
          renombrarlas, añadir observaciones, compararlas y exportarlas como JSON o como un informe educativo en Markdown. La exportación ocurre íntegramente en tu navegador.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll}>
            {showAll ? 'Mostrar solo guardadas' : 'Mostrar también no guardadas'}
          </Button>
          <Button size="sm" disabled={!exportTarget.length} onClick={() => downloadFile('privacyml-lab-experimentos.json', runsToJson(exportTarget))}>
            <Download /> Exportar JSON {sel.length ? `(${sel.length})` : '(todas las visibles)'}
          </Button>
          <Button size="sm" variant="secondary" disabled={!exportTarget.length} onClick={() => downloadFile('privacyml-lab-informe.md', buildReport(exportTarget), 'text/markdown')}>
            <FileText /> Exportar informe {sel.length ? `(${sel.length})` : '(todas las visibles)'}
          </Button>
        </div>
      </header>
      {runs.length === 0 ? (
        <Callout title="No hay ejecuciones guardadas">
          Ejecuta un experimento y pulsa la estrella en su línea temporal para guardarlo aquí. Empieza por <a className="underline" href={href('/dp/1')}>el primer experimento</a>.
        </Callout>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runs.map((r) => {
            const exp = experimentById(r.experimentId);
            const isSel = selected.includes(r.id);
            return (
              <li key={r.id} className={cn('space-y-2 rounded-lg border bg-card p-4', isSel && 'border-primary ring-1 ring-primary')}>
                <div className="flex items-start justify-between gap-2">
                  {editing === r.id ? (
                    <form className="flex w-full gap-1" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) update(r.id, { name: draft.trim() }); setEditing(null); }}>
                      <Input autoFocus aria-label="Nuevo nombre" value={draft} onChange={(e) => setDraft(e.target.value)} />
                      <Button size="icon" variant="ghost" type="submit" aria-label="Confirmar nombre">
                        <Check />
                      </Button>
                    </form>
                  ) : (
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{r.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        {exp ? <a className="underline-offset-2 hover:underline" href={href(exp.path)}>{r.experimentTitle}</a> : r.experimentTitle} · {new Date(r.createdAt).toLocaleString('es-ES')}
                      </p>
                    </div>
                  )}
                  {r.saved ? <Badge variant="warn">Guardada</Badge> : <Badge variant="secondary">Temporal</Badge>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {Object.entries(r.results)
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="truncate text-muted-foreground">{k}</dt>
                        <dd className="num text-right">{typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 4 }) : String(v ?? '—')}</dd>
                      </div>
                    ))}
                </dl>
                <p className="text-xs">
                  <span className="text-muted-foreground">Garantía: </span>
                  {r.privacyGuarantee ?? 'ninguna garantía formal establecida'}
                </p>
                <Textarea aria-label={`Observaciones de ${r.name}`} className="min-h-[56px] text-xs" placeholder="Observaciones del estudiante…" value={r.notes} onChange={(e) => update(r.id, { notes: e.target.value })} />
                <div className="flex gap-1">
                  <Button size="sm" variant={isSel ? 'default' : 'outline'} aria-pressed={isSel} onClick={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}>
                    <GitCompareArrows /> Comparar
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Renombrar ${r.name}`} onClick={() => { setEditing(r.id); setDraft(r.name); }}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={r.saved ? 'Quitar de guardadas' : 'Guardar'} onClick={() => update(r.id, { saved: !r.saved })}>
                    <Star className={r.saved ? 'fill-current text-warn' : ''} />
                  </Button>
                  <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Eliminar ${r.name}`} onClick={() => setAll((prev) => prev.filter((x) => x.id !== r.id))}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sel.length > 0 && (
        <section className="rounded-lg border bg-card p-4" aria-label="Comparación">
          <h2 className="mb-2 text-sm font-semibold">Comparación de {sel.length} ejecuciones</h2>
          {new Set(sel.map((r) => r.experimentId)).size > 1 && <p className="mb-2 text-xs text-warn">Atención: estás comparando ejecuciones de experimentos distintos; algunas métricas no son comparables.</p>}
          <RunComparisonTable runs={sel} />
        </section>
      )}
    </div>
  );
}
