import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { AlertTriangle, ChevronDown, Info, OctagonAlert, ThumbsUp, ThumbsDown, Sigma, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/input';
import { usePersistentState } from '@/lib/store';

/** Bloque de fórmula (monoespaciado). */
export function Formula({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn('formula', className)} role="math" aria-label={label}>
      {children}
    </div>
  );
}

export function StatTile({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'dp' | 'fl' | 'warn' | 'ok' | 'muted'; className?: string }) {
  const toneCls = { dp: 'text-dp', fl: 'text-fl', warn: 'text-warn', ok: 'text-ok', muted: 'text-muted-foreground' }[tone ?? 'muted'];
  return (
    <div className={cn('rounded-md border bg-card px-3 py-2', className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('num text-lg font-semibold leading-tight', tone && tone !== 'muted' ? toneCls : '')}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Callout({ kind = 'info', title, children, className }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children: ReactNode; className?: string }) {
  const map = {
    info: { cls: 'border-primary/30 bg-primary/5', Icon: Info, ic: 'text-primary' },
    warn: { cls: 'border-warn/40 bg-warn/10', Icon: AlertTriangle, ic: 'text-warn' },
    danger: { cls: 'border-destructive/40 bg-destructive/10', Icon: OctagonAlert, ic: 'text-destructive' },
    ok: { cls: 'border-ok/40 bg-ok/10', Icon: ThumbsUp, ic: 'text-ok' },
  }[kind];
  return (
    <div className={cn('flex gap-2 rounded-md border p-3 text-sm', map.cls, className)} role={kind === 'danger' ? 'alert' : undefined}>
      <map.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', map.ic)} aria-hidden />
      <div className="min-w-0 space-y-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-[13px]">{children}</div>
      </div>
    </div>
  );
}

/** Lista de errores de validación de configuración. */
export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <Callout kind="danger" title="Configuración no válida">
      <ul className="list-disc pl-4">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </Callout>
  );
}

interface CalcRow {
  label: ReactNode;
  value: ReactNode;
}

/**
 * "Ver cálculos": revela ecuaciones, entradas, valores intermedios, supuestos y salidas.
 */
export function ShowCalculations({
  equations,
  inputs,
  intermediates,
  assumptions,
  outputs,
  children,
  defaultOpen = false,
}: {
  equations?: ReactNode[];
  inputs?: CalcRow[];
  intermediates?: CalcRow[];
  assumptions?: string[];
  outputs?: CalcRow[];
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const table = (title: string, rows?: CalcRow[]) =>
    rows && rows.length ? (
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-muted-foreground">
                  {r.label}
                </th>
                <td className="num py-1 text-right">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50">
        <span className="flex items-center gap-2">
          <Sigma className="h-4 w-4 text-primary" aria-hidden /> Ver cálculos
          <span className="text-xs font-normal text-muted-foreground">ecuaciones, entradas, valores intermedios, supuestos y salidas</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </Collapsible.Trigger>
      <Collapsible.Content className="grid gap-4 border-t p-4 md:grid-cols-2">
        {equations && equations.length > 0 && (
          <div className="space-y-2 md:col-span-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ecuaciones</h4>
            {equations.map((e, i) => (
              <Formula key={i}>{e}</Formula>
            ))}
          </div>
        )}
        {table('Entradas', inputs)}
        {table('Valores intermedios', intermediates)}
        {table('Salidas', outputs)}
        {assumptions && assumptions.length > 0 && (
          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Supuestos</h4>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed">
              {assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {children && <div className="md:col-span-2">{children}</div>}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function ProsCons({ benefits, limitations }: { benefits: string[]; limitations: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ok">
          <ThumbsUp className="h-4 w-4" aria-hidden /> Beneficios
        </h3>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
          {benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
          <ThumbsDown className="h-4 w-4" aria-hidden /> Limitaciones
        </h3>
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
          {limitations.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Pregunta de reflexión; la respuesta se guarda localmente y se incluye en el informe. */
export function Reflection({ experimentId, question, hint }: { experimentId: string; question: string; hint?: string }) {
  const [text, setText] = usePersistentState<string>(`reflection:${experimentId}`, '');
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText className="h-4 w-4 text-primary" aria-hidden /> Reflexión
      </h3>
      <p className="mb-2 text-[13px] leading-relaxed">{question}</p>
      <Textarea aria-label="Tu respuesta a la pregunta de reflexión" placeholder="Escribe tus observaciones (se guardan en tu navegador y se incluyen en el informe exportado)…" value={text} onChange={(e) => setText(e.target.value)} />
      {hint && (
        <div className="mt-2">
          <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setShowHint((s) => !s)} aria-expanded={showHint}>
            {showHint ? 'Ocultar pista' : 'Mostrar pista'}
          </button>
          {showHint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      )}
    </div>
  );
}

/** Indicador de pasos: Observar → Entender → Configurar → Ejecutar → Inspeccionar → Comparar → Reflexionar. */
export const METHOD_STEPS = ['Observar', 'Entender', 'Configurar', 'Ejecutar', 'Inspeccionar', 'Comparar', 'Reflexionar'] as const;
