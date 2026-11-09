import { useId, useState, type ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import { ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';

export interface DataColumn<T> {
  key: keyof T & string;
  label: string;
  format?: (v: unknown) => string;
}

/**
 * Contenedor accesible de gráficos: título, descripción textual (para lectores de pantalla)
 * y un botón «Ver datos» que muestra la tabla de valores subyacente.
 */
export function ChartFrame<T extends object>({
  title,
  description,
  height = 260,
  data,
  columns,
  children,
  footer,
}: {
  title: string;
  description: string;
  height?: number;
  data?: T[];
  columns?: DataColumn<T>[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="space-y-2" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <div className="flex items-start justify-between gap-2">
        <figcaption>
          <div id={`${id}-t`} className="text-sm font-medium">
            {title}
          </div>
          <div id={`${id}-d`} className="text-xs text-muted-foreground">
            {description}
          </div>
        </figcaption>
        {data && columns && (
          <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" aria-expanded={showTable} onClick={() => setShowTable((s) => !s)}>
            <Table2 /> {showTable ? 'Ocultar datos' : 'Ver datos'}
          </Button>
        )}
      </div>
      <div role="img" aria-label={`${title}. ${description}`} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
      {footer}
      {showTable && data && columns && (
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <caption className="sr-only">Datos de: {title}</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-2 py-1 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => {
                    const v = row[c.key] as unknown;
                    return (
                      <td key={c.key} className="num px-2 py-1 text-right">
                        {c.format ? c.format(v) : typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 4 }) : String(v ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
