import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { BookOpen, ChevronDown, SlidersHorizontal, Eye, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GuaranteeKind } from '@/lib/runs';
import { IntegrityBadge } from './IntegrityBadge';
import { ProsCons, Reflection, METHOD_STEPS } from './Blocks';

export interface ExperimentLayoutProps {
  experimentId: string;
  module: 'dp' | 'fl' | 'combined';
  /** p. ej. "Experimento 2" */
  kicker?: string;
  title: string;
  objective: string;
  /** Explicación conceptual (empezar con un ejemplo concreto antes de la notación). */
  intro: ReactNode;
  badges?: GuaranteeKind[];
  /** Panel izquierdo — Configuración */
  config: ReactNode;
  /** Panel central — Visualización interactiva */
  visual: ReactNode;
  /** Panel derecho — Observaciones */
  observations: ReactNode;
  /** Panel inferior — Línea temporal del experimento */
  timeline?: ReactNode;
  /** Bloque "Ver cálculos" y otros detalles debajo del área principal */
  details?: ReactNode;
  prosCons?: { benefits: string[]; limitations: string[] };
  reflection?: { question: string; hint?: string };
}

export function ExperimentLayout(p: ExperimentLayoutProps) {
  const [introOpen, setIntroOpen] = useState(true);
  const accent = p.module === 'dp' ? 'text-dp' : p.module === 'fl' ? 'text-fl' : 'text-primary';
  return (
    <article className="space-y-4" aria-labelledby={`${p.experimentId}-title`}>
      <header className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {p.kicker && <p className={cn('text-xs font-semibold uppercase tracking-wider', accent)}>{p.kicker}</p>}
            <h1 id={`${p.experimentId}-title`} className="text-xl font-semibold tracking-tight sm:text-2xl">
              {p.title}
            </h1>
          </div>
          {p.badges && (
            <div className="flex flex-wrap gap-1.5">
              {p.badges.map((b) => (
                <IntegrityBadge key={b} kind={b} />
              ))}
            </div>
          )}
        </div>
        <p className="mt-3 flex gap-2 text-sm leading-relaxed">
          <Target className={cn('mt-0.5 h-4 w-4 shrink-0', accent)} aria-hidden />
          <span>
            <strong>Objetivo de aprendizaje:</strong> {p.objective}
          </span>
        </p>
        <ol className="mt-3 flex flex-wrap gap-1 text-[11px] text-muted-foreground" aria-label="Metodología">
          {METHOD_STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span className="rounded-full border px-2 py-0.5">{s}</span>
              {i < METHOD_STEPS.length - 1 && <span aria-hidden>→</span>}
            </li>
          ))}
        </ol>
        <Collapsible.Root open={introOpen} onOpenChange={setIntroOpen} className="mt-3">
          <Collapsible.Trigger className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            <BookOpen className="h-4 w-4" aria-hidden /> Explicación conceptual
            <ChevronDown className={cn('h-4 w-4 transition-transform', introOpen && 'rotate-180')} aria-hidden />
          </Collapsible.Trigger>
          <Collapsible.Content className="prose-lab mt-2 max-w-4xl text-[0.95rem] leading-relaxed">{p.intro}</Collapsible.Content>
        </Collapsible.Root>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)] xl:grid-cols-[minmax(250px,290px)_minmax(0,1fr)_minmax(260px,320px)]">
        <section aria-label="Configuración" className="space-y-3 rounded-lg border bg-card p-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden /> Configuración
          </h2>
          {p.config}
        </section>
        <section aria-label="Visualización interactiva" className="min-w-0 space-y-4">
          {p.visual}
        </section>
        <section aria-label="Observaciones" className="space-y-3 rounded-lg border bg-card p-4 lg:col-span-2 xl:col-span-1 xl:self-start">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden /> Observaciones
          </h2>
          {p.observations}
        </section>
      </div>

      {p.timeline}
      {p.details}
      {p.prosCons && <ProsCons {...p.prosCons} />}
      {p.reflection && <Reflection experimentId={p.experimentId} {...p.reflection} />}
    </article>
  );
}

/** Tarjeta para el panel central. */
export function VisualCard({ title, children, actions, className, description }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
