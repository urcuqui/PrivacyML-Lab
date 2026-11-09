import { useEffect, useId, useState, type ReactNode } from 'react';
import { Dices } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ParamSliderProps {
  label: ReactNode;
  /** Etiqueta de texto plano para lectores de pantalla. */
  ariaLabel: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** Texto de ayuda breve bajo el control. */
  help?: ReactNode;
  /** Formato del valor mostrado. */
  format?: (v: number) => string;
  /** Función de validación: devuelve mensaje de error o null. */
  validate?: (v: number) => string | null;
  /** Escala logarítmica (útil para ε). */
  log?: boolean;
  disabled?: boolean;
  unit?: string;
}

/** Control numérico con deslizador + entrada de texto + validación. */
export function ParamSlider({ label, ariaLabel, value, onChange, min, max, step, help, format, validate, log, disabled, unit }: ParamSliderProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(String(value)), [value]);
  const toSlider = (v: number) => (log ? Math.log10(v) : v);
  const fromSlider = (s: number) => {
    if (!log) return s;
    const v = 10 ** s;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return Number(v.toFixed(decimals));
  };
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(v)) {
      setError('Introduce un número válido.');
      return;
    }
    if (v < min || v > max) {
      setError(`El valor debe estar entre ${min} y ${max}.`);
      return;
    }
    const custom = validate?.(v) ?? null;
    if (custom) {
      setError(custom);
      return;
    }
    setError(null);
    onChange(v);
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            inputMode="decimal"
            className="h-7 w-20 text-right num text-xs"
            value={text}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          />
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
      </div>
      <Slider
        thumbLabel={ariaLabel}
        disabled={disabled}
        min={toSlider(min)}
        max={toSlider(max)}
        step={log ? 0.01 : step}
        value={[toSlider(Math.min(max, Math.max(min, value)))]}
        onValueChange={([s]) => {
          const v = fromSlider(s);
          const custom = validate?.(v) ?? null;
          setError(custom);
          if (!custom) onChange(v);
        }}
        aria-valuetext={format ? format(value) : String(value)}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : help ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}

/** Selector de opciones discretas (p. ej. ε ∈ {0.1, 0.5, 1, 2, 5, 10}). */
export function ParamChoice<T extends string | number>({
  label,
  value,
  options,
  onChange,
  help,
  format,
}: {
  label: ReactNode;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  help?: ReactNode;
  format?: (v: T) => string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div id={id} className="text-xs font-medium">
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={o === value}
            onClick={() => onChange(o)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs num transition-colors',
              o === value ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:bg-accent',
            )}
          >
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
      {help && <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>}
    </div>
  );
}

export function ParamToggle({ label, checked, onChange, help }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; help?: ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {help && <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Semilla aleatoria con aviso de que es solo para reproducibilidad. */
export function SeedControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const v = Math.trunc(Number(raw));
    if (Number.isFinite(v) && v >= 0) onChange(v >>> 0);
    else setText(String(value));
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        Semilla aleatoria (seed)
      </label>
      <div className="flex gap-1">
        <Input id={id} className="h-7 num text-xs" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)} />
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" aria-label="Generar semilla nueva" title="Generar semilla nueva" onClick={() => onChange(Math.floor(Math.random() * 1e6))}>
          <Dices />
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">Solo para reproducibilidad experimental. No es aleatoriedad segura y cambiarla no repone el presupuesto de privacidad.</p>
    </div>
  );
}

export function ConfigSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t pt-3 first:border-t-0 first:pt-0">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}
