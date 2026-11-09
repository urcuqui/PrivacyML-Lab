import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/** Término técnico con definición emergente (accesible por teclado). */
export function Term({ k, children, className }: { k: GlossaryKey; children?: ReactNode; className?: string }) {
  const g = GLOSSARY[k];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('cursor-help border-b border-dotted border-current/60 text-left leading-tight decoration-transparent focus-visible:rounded-sm', className)}
          aria-label={`${g.term}: ${g.def}`}
        >
          {children ?? g.term}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="mb-1 font-semibold">{g.term}</p>
        <p>{g.def}</p>
      </TooltipContent>
    </Tooltip>
  );
}
