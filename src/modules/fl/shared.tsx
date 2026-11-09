import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { C, SERIES } from '@/components/charts/chartTheme';
import type { Sample } from '@/lib/ml/logistic';
import type { ResultValue } from '@/lib/runs';
import type { Vec } from '@/lib/vec';
import { cn } from '@/lib/utils';

/** Formato numérico en español. */
export function f(v: number | null | undefined, d = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
export function pct(v: number | null | undefined, d = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`;
}

export const PARAM_NAMES = ['w₁', 'w₂', 'b'] as const;

/** Muestra un vector de parámetros [w₁, w₂, b]. */
export function ParamVec({ v, digits = 4, className }: { v: Vec; digits?: number; className?: string }) {
  return (
    <span className={cn('num whitespace-nowrap text-xs', className)}>
      [{v.map((x, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <span title={PARAM_NAMES[i]}>{f(x, digits)}</span>
        </span>
      ))}]
    </span>
  );
}

/** Convierte parámetros a un registro con etiquetas en español (para el historial). */
export function toLabelled<T extends object>(params: T, labels: Record<keyof T & string, string>): Record<string, ResultValue> {
  const out: Record<string, ResultValue> = {};
  for (const k of Object.keys(labels) as (keyof T & string)[]) {
    const v = params[k] as unknown;
    out[labels[k]] = typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : v === null || v === undefined ? null : String(v);
  }
  return out;
}

/** Recupera parámetros a partir del registro etiquetado de una ejecución anterior. */
export function fromLabelled<T extends object>(stored: Record<string, ResultValue>, labels: Record<keyof T & string, string>, defaults: T): T {
  const out = { ...defaults } as Record<string, unknown>;
  for (const k of Object.keys(labels)) {
    const v = stored[labels[k as keyof T & string]];
    if (v !== undefined && v !== null && typeof v === typeof (defaults as Record<string, unknown>)[k]) out[k] = v;
  }
  return out as T;
}

/** Segmento de la frontera de decisión w₁x + w₂y + b = 0 recortado a [-L, L]². */
export function boundarySegment(p: Vec, L: number): [number, number, number, number] | null {
  const [w1, w2, b] = p;
  const pts: [number, number][] = [];
  if (Math.abs(w2) > 1e-12) {
    for (const x of [-L, L]) {
      const y = -(w1 * x + b) / w2;
      if (y >= -L && y <= L) pts.push([x, y]);
    }
  }
  if (Math.abs(w1) > 1e-12) {
    for (const y of [-L, L]) {
      const x = -(w2 * y + b) / w1;
      if (x >= -L && x <= L) pts.push([x, y]);
    }
  }
  if (pts.length < 2) return null;
  // eliminar duplicados (esquinas)
  const a = pts[0];
  const bpt = pts.find((q) => Math.hypot(q[0] - a[0], q[1] - a[1]) > 1e-9);
  return bpt ? [a[0], a[1], bpt[0], bpt[1]] : null;
}

export interface BoundaryLine {
  params: Vec;
  color: string;
  label: string;
  dashed?: boolean;
  width?: number;
}

/**
 * Diagrama de dispersión SVG ligero (clase 0 = círculo, clase 1 = triángulo; color + forma
 * para no depender solo del color) con fronteras de decisión opcionales.
 */
export function ClientScatter({
  samples,
  lines = [],
  L = 5,
  size = 180,
  title,
  maxPoints = 250,
  extra,
}: {
  samples: readonly Sample[];
  lines?: BoundaryLine[];
  L?: number;
  size?: number;
  title: string;
  maxPoints?: number;
  extra?: (sx: (x: number) => number, sy: (y: number) => number) => ReactNode;
}) {
  const pad = 4;
  const sx = (x: number) => pad + ((x + L) / (2 * L)) * (size - 2 * pad);
  const sy = (y: number) => size - pad - ((y + L) / (2 * L)) * (size - 2 * pad);
  const pts = samples.slice(0, maxPoints);
  const n1 = samples.filter((s) => s.y === 1).length;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full rounded-md border bg-background" role="img" aria-label={`${title}: ${samples.length} muestras, ${n1} de clase 1 y ${samples.length - n1} de clase 0${lines.length ? `, con ${lines.length} fronteras de decisión` : ''}.`}>
      <line x1={sx(0)} x2={sx(0)} y1={pad} y2={size - pad} stroke={C.grid} strokeWidth={0.6} />
      <line y1={sy(0)} y2={sy(0)} x1={pad} x2={size - pad} stroke={C.grid} strokeWidth={0.6} />
      {pts.map((s, i) => {
        const x = sx(Math.max(-L, Math.min(L, s.x[0])));
        const y = sy(Math.max(-L, Math.min(L, s.x[1])));
        return s.y === 1 ? (
          <path key={i} d={`M${x},${y - 2.6} L${x + 2.4},${y + 1.8} L${x - 2.4},${y + 1.8} Z`} fill={C.c4} fillOpacity={0.75} />
        ) : (
          <circle key={i} cx={x} cy={y} r={1.9} fill={C.c1} fillOpacity={0.65} />
        );
      })}
      {lines.map((ln, i) => {
        const seg = boundarySegment(ln.params, L);
        if (!seg) return null;
        return <line key={i} x1={sx(seg[0])} y1={sy(seg[1])} x2={sx(seg[2])} y2={sy(seg[3])} stroke={ln.color} strokeWidth={ln.width ?? 1.6} strokeDasharray={ln.dashed ? '4 3' : undefined} />;
      })}
      {extra?.(sx, sy)}
    </svg>
  );
}

export function ScatterLegend({ lines = [] }: { lines?: BoundaryLine[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <svg width="10" height="10" aria-hidden>
          <circle cx="5" cy="5" r="3" fill={C.c1} />
        </svg>
        Clase 0 (riesgo bajo)
      </span>
      <span className="flex items-center gap-1">
        <svg width="10" height="10" aria-hidden>
          <path d="M5,1 L9,9 L1,9 Z" fill={C.c4} />
        </svg>
        Clase 1 (riesgo alto)
      </span>
      {lines.map((l) => (
        <span key={l.label} className="flex items-center gap-1">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? '3 2' : undefined} />
          </svg>
          {l.label}
        </span>
      ))}
    </div>
  );
}

export const clientColor = (k: number) => SERIES[k % SERIES.length];

/** Controles de pasos: anterior / siguiente / reproducir. */
export function useStepper(count: number, intervalMs = 1600) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (step > count - 1) setStep(Math.max(0, count - 1));
  }, [count, step]);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (s >= count - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, intervalMs);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, count, intervalMs]);
  const play = useCallback(() => {
    setStep((s) => (s >= count - 1 ? 0 : s));
    setPlaying((p) => !p);
  }, [count]);
  return { step, setStep, playing, play, prev: () => setStep((s) => Math.max(0, s - 1)), next: () => setStep((s) => Math.min(count - 1, s + 1)) };
}

export function StepControls({ stepper, count, label }: { stepper: ReturnType<typeof useStepper>; count: number; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Controles de pasos: ${label}`}>
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={stepper.prev} disabled={stepper.step === 0} aria-label="Paso anterior">
        <SkipBack />
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={stepper.play} aria-label={stepper.playing ? 'Pausar' : 'Reproducir'}>
        {stepper.playing ? <Pause /> : <Play />}
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={stepper.next} disabled={stepper.step >= count - 1} aria-label="Paso siguiente">
        <SkipForward />
      </Button>
      <span className="num ml-1 text-xs text-muted-foreground" aria-live="polite">
        {stepper.step + 1}/{count}
      </span>
    </div>
  );
}
