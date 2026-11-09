/** Colores y estilos comunes para Recharts (usan variables CSS del tema claro/oscuro). */
export const C = {
  c1: 'hsl(var(--chart-1))',
  c2: 'hsl(var(--chart-2))',
  c3: 'hsl(var(--chart-3))',
  c4: 'hsl(var(--chart-4))',
  c5: 'hsl(var(--chart-5))',
  dp: 'hsl(var(--dp))',
  fl: 'hsl(var(--fl))',
  warn: 'hsl(var(--warn))',
  ok: 'hsl(var(--ok))',
  grid: 'hsl(var(--grid))',
  axis: 'hsl(var(--muted-foreground))',
  fg: 'hsl(var(--foreground))',
  muted: 'hsl(var(--muted-foreground))',
} as const;

export const SERIES = [C.c1, C.c2, C.c3, C.c4, C.c5, 'hsl(200 60% 50%)', 'hsl(90 45% 40%)', 'hsl(300 45% 50%)', 'hsl(20 70% 50%)', 'hsl(160 30% 45%)'];

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: { stroke: C.grid },
  axisLine: { stroke: C.grid },
} as const;

export const gridProps = { stroke: C.grid, strokeDasharray: '3 3' } as const;

export const tooltipProps = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 6,
    fontSize: 12,
    color: 'hsl(var(--popover-foreground))',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
} as const;

export const legendProps = { wrapperStyle: { fontSize: 12 } } as const;

export const fmtNum = (d = 3) => (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: d }) : String(v));
