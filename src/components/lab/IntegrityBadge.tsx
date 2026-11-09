import { Calculator, FlaskConical, ShieldCheck, Lightbulb, LineChart, CircleSlash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GuaranteeKind } from '@/lib/runs';

export const INTEGRITY: Record<GuaranteeKind, { label: string; desc: string; variant: 'ok' | 'dp' | 'fl' | 'warn' | 'secondary' | 'destructive'; Icon: typeof Calculator }> = {
  real: { label: 'Cálculo real', desc: 'Valores calculados en tu navegador a partir de los parámetros y datos sintéticos actuales. No hay resultados precalculados.', variant: 'ok', Icon: Calculator },
  sim: { label: 'Simulación educativa', desc: 'Simulación simplificada con modelos pequeños y datos sintéticos. Los mecanismos son reales, pero el entorno no representa un sistema en producción.', variant: 'fl', Icon: FlaskConical },
  formal: { label: 'Garantía formal bajo supuestos', desc: 'Resultado matemático demostrado que solo se cumple si se satisfacen TODOS los supuestos indicados (sensibilidad, vecindad, aleatoriedad segura, contabilidad…).', variant: 'dp', Icon: ShieldCheck },
  concept: { label: 'Ilustración conceptual', desc: 'Representación visual para explicar una idea. No es una implementación ni una medición.', variant: 'secondary', Icon: Lightbulb },
  empirical: { label: 'Observación empírica', desc: 'Resultado medido en repeticiones de la simulación. Depende de la semilla, los datos y la configuración; no es una garantía.', variant: 'warn', Icon: LineChart },
  'not-computed': { label: 'No calculado', desc: 'No se muestra un valor porque no se ha implementado un método válido para calcularlo bajo esta configuración. No inventamos cifras.', variant: 'destructive', Icon: CircleSlash },
};

export function IntegrityBadge({ kind, className }: { kind: GuaranteeKind; className?: string }) {
  const { label, desc, variant, Icon } = INTEGRITY[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${label}: ${desc}`}>
          <Badge variant={variant} className={className}>
            <Icon className="h-3 w-3" aria-hidden />
            {label}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent>{desc}</TooltipContent>
    </Tooltip>
  );
}
