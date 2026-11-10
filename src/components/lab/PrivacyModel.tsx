import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, ShieldCheck, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IntegrityBadge } from './IntegrityBadge';
import { ParamChoice } from './ParamControl';
import { ADJACENCY_INFO, UNIT_INFO, type Adjacency, type PrivacySpec } from '@/lib/privacy/model';
import type { PrivacyAccounting } from '@/lib/dp/accountant';

const fmt = (v: number, d = 3) => v.toLocaleString('es-ES', { maximumFractionDigits: d });
const fmtDelta = (d: number) => (d < 1e-3 ? Number(d.toPrecision(3)).toExponential() : fmt(d, 4));

/** Selector de vecindad (añadir/eliminar frente a reemplazar) con explicación. */
export function AdjacencyChoice({ value, onChange, unitLabel = 'unidad protegida' }: { value: Adjacency; onChange: (a: Adjacency) => void; unitLabel?: string }) {
  return (
    <ParamChoice<Adjacency>
      label="Definición de vecinos (adjacency)"
      value={value}
      options={['add-remove', 'replace'] as const}
      format={(a) => (a === 'add-remove' ? 'Añadir/eliminar' : 'Reemplazar')}
      onChange={onChange}
      help={
        value === 'add-remove'
          ? `Vecinos: se añade o elimina una ${unitLabel}. Suma recortada: Δ₂ = C. El tamaño no es público.`
          : `Vecinos: se reemplaza una ${unitLabel}; el tamaño es público. Suma recortada: Δ₂ = 2C.`
      }
    />
  );
}

/**
 * Tarjeta del modelo de privacidad: unidad, vecindad, sensibilidad, ruido, modelo de confianza,
 * resultado de la contabilidad (ε, δ) o "No calculado", y salidas fuera de la garantía.
 */
export function PrivacyModelCard({
  spec,
  accounting,
  pureEpsilon,
  compact = false,
  extra,
}: {
  spec: PrivacySpec;
  /** Resultado del contador (mecanismos gaussianos). */
  accounting?: PrivacyAccounting | null;
  /** ε de un mecanismo ε-DP puro (Laplace) por publicación. */
  pureEpsilon?: number;
  compact?: boolean;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(!compact);
  return (
    <section className="rounded-lg border border-dp/30 bg-card" aria-label="Modelo de privacidad">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/40">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 shrink-0 text-dp" aria-hidden /> Modelo de privacidad
            <span className="truncate text-xs font-normal text-muted-foreground">
              {UNIT_INFO[spec.unit].label} · {ADJACENCY_INFO[spec.adjacency].label}
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
        </Collapsible.Trigger>
        <Collapsible.Content className="space-y-3 border-t px-4 py-3 text-[13px] leading-relaxed">
          <div className="flex flex-wrap items-center gap-2">
            {accounting?.status === 'computed' ? (
              <>
                <IntegrityBadge kind="formal" />
                <span className="num font-semibold text-dp">
                  (ε, δ) = ({fmt(accounting.epsilon)}, {fmtDelta(accounting.delta)})
                </span>
              </>
            ) : accounting?.status === 'not-computed' ? (
              <>
                <IntegrityBadge kind="not-computed" />
                <span className="font-semibold">ε: No calculado</span>
              </>
            ) : pureEpsilon !== undefined ? (
              <>
                <IntegrityBadge kind="formal" />
                <span className="num font-semibold text-dp">ε = {fmt(pureEpsilon)} por publicación (ε-DP puro, δ = 0)</span>
              </>
            ) : null}
          </div>
          {accounting?.status === 'not-computed' && <p className="rounded-md bg-muted p-2 text-xs">{accounting.reason}</p>}
          <dl className="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[150px_1fr]">
            <dt className="text-muted-foreground">Mecanismo</dt>
            <dd>{spec.mechanism}</dd>
            <dt className="text-muted-foreground">Unidad protegida</dt>
            <dd>{UNIT_INFO[spec.unit].definition}</dd>
            <dt className="text-muted-foreground">Vecindad</dt>
            <dd>
              {ADJACENCY_INFO[spec.adjacency].definition} {ADJACENCY_INFO[spec.adjacency].sizeNote}
            </dd>
            <dt className="text-muted-foreground">Sensibilidad ({spec.sensitivityNorm})</dt>
            <dd>{spec.sensitivity}</dd>
            <dt className="text-muted-foreground">Ruido</dt>
            <dd className="num">{spec.noise}</dd>
            {accounting?.status === 'computed' && (
              <>
                <dt className="text-muted-foreground">Contabilidad</dt>
                <dd className="num">
                  z = σ/k = {fmt(accounting.details.effectiveNoiseMultiplier, 4)} · T = {accounting.details.compositions} composiciones · α* = {fmt(accounting.optimalAlpha, 2)} · ε_RDP(α*) ={' '}
                  {fmt(accounting.details.rdpAtOptimalAlpha, 4)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Modelo de confianza</dt>
            <dd>{spec.trustModel}</dd>
          </dl>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ok">Protege frente a</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {spec.protectsAgainst.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h4 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Salidas cubiertas</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {spec.coveredOutputs.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-warn">No protege frente a</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {spec.doesNotProtectAgainst.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h4 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-destructive">Mostrado pero FUERA de la garantía</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {spec.outsideGuarantee.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          {accounting?.status === 'computed' && (
            <details className="text-xs">
              <summary className="cursor-pointer text-primary">Supuestos del contador de privacidad ({accounting.assumptions.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {accounting.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {extra}
        </Collapsible.Content>
      </Collapsible.Root>
    </section>
  );
}

/**
 * Comprobación contextual ligera y opcional: una pregunta sobre el experimento actual cuya
 * explicación se construye a partir de los resultados REALES del estudiante (`explanation`).
 * Si aún no hay resultados, muestra `pendingHint`.
 */
export function ContextualCheck({ question, explanation, pendingHint = 'Ejecuta el experimento para obtener una explicación basada en tus resultados.' }: { question: string; explanation: ReactNode | null; pendingHint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/[0.03] p-3">
      <p className="flex gap-2 text-[13px] font-medium leading-snug">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-primary">Pregunta sobre tu experimento ·</span>
          {question}
        </span>
      </p>
      <button type="button" className="mt-1.5 text-xs text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Ocultar explicación' : 'Piensa tu respuesta y luego muestra la explicación'}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed" aria-live="polite">
          {explanation ?? <p className="text-muted-foreground">{pendingHint}</p>}
        </div>
      )}
    </div>
  );
}
