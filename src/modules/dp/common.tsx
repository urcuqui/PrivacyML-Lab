import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, FunctionSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultValue } from '@/lib/runs';

/** Formato numérico en español. */
export const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toLocaleString('es-ES', { maximumFractionDigits: d }) : '—');

/** Convierte parámetros a un mapa con etiquetas en español (para el historial). */
export function toLabeled<T extends Record<string, ResultValue>>(params: T, labels: Record<keyof T, string>): Record<string, ResultValue> {
  const out: Record<string, ResultValue> = {};
  for (const k of Object.keys(labels) as (keyof T)[]) out[labels[k]] = params[k];
  return out;
}

/** Recupera parámetros a partir del mapa etiquetado de una ejecución. */
export function fromLabeled<T extends Record<string, ResultValue>>(labeled: Record<string, ResultValue>, labels: Record<keyof T, string>, defaults: T): T {
  const out = { ...defaults };
  for (const k of Object.keys(labels) as (keyof T)[]) {
    const v = labeled[labels[k]];
    if (v !== undefined && v !== null && typeof v === typeof defaults[k]) (out as Record<keyof T, ResultValue>)[k] = v;
  }
  return out;
}

/** Sección desplegable para explicaciones matemáticas. */
export function MathSection({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50">
        <span className="flex items-center gap-2">
          <FunctionSquare className="h-4 w-4 text-dp" aria-hidden /> {title}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-3 border-t p-4 text-sm leading-relaxed">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

/** Lista de definición de términos de una ecuación. */
export function TermList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[auto_1fr]">
      {items.map(([t, d], i) => (
        <div key={i} className="contents">
          <dt className="num font-semibold text-dp">{t}</dt>
          <dd className="text-muted-foreground">{d}</dd>
        </div>
      ))}
    </dl>
  );
}

export const EPS_OPTIONS = [0.1, 0.5, 1, 2, 5, 10] as const;
