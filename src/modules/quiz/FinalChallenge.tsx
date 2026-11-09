import { useId, useState } from 'react';
import { CheckCircle2, XCircle, CircleDot, Building2, Smartphone, Landmark, RotateCcw, ClipboardCheck, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/lab/Blocks';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { Term } from '@/components/lab/Term';
import { usePersistentState } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  ARCHITECTURES,
  DEFAULT_CHOICE,
  EMPTY_CHALLENGE,
  EPOCHS_LABELS,
  NOISE_LABELS,
  PARTICIPATION_LABELS,
  SCENARIOS,
  UNIT_LABELS,
  settingsRelevance,
  verdict,
  type ChallengeChoice,
  type ChallengeState,
  type Scenario,
  type Status,
} from './challenge';

const ICONS = { hospitals: Building2, keyboard: Smartphone, agency: Landmark } as Record<string, typeof Building2>;

const STATUS_UI: Record<Status, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  meets: { label: 'Cumple', cls: 'text-ok border-ok/40 bg-ok/10', Icon: CheckCircle2 },
  partial: { label: 'Parcial', cls: 'text-warn border-warn/40 bg-warn/10', Icon: CircleDot },
  fails: { label: 'No cumple', cls: 'text-destructive border-destructive/40 bg-destructive/10', Icon: XCircle },
};

function RadioRow<T extends string>({ legend, value, options, labels, onChange, disabled, help }: { legend: React.ReactNode; value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void; disabled?: boolean; help?: string }) {
  const name = useId();
  return (
    <fieldset className={cn('space-y-1.5', disabled && 'opacity-50')} disabled={disabled}>
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o} className={cn('flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-ring', value === o ? 'border-primary bg-primary/10' : 'bg-card hover:bg-accent', disabled && 'cursor-not-allowed')}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} className="accent-[hsl(var(--primary))]" />
            {labels[o]}
          </label>
        ))}
      </div>
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </fieldset>
  );
}

function ScenarioCard({ s, choice, submitted, setChoice, setSubmitted }: { s: Scenario; choice: ChallengeChoice; submitted: boolean; setChoice: (c: ChallengeChoice) => void; setSubmitted: (v: boolean) => void }) {
  const Icon = ICONS[s.id] ?? Building2;
  const archName = useId();
  const rel = settingsRelevance(choice.architecture);
  const update = (patch: Partial<ChallengeChoice>) => {
    setChoice({ ...choice, ...patch });
    setSubmitted(false);
  };
  const evals = submitted && choice.architecture ? s.evaluate(choice) : null;
  const v = evals ? verdict(evals) : null;
  return (
    <article className="rounded-lg border bg-card" aria-labelledby={`sc-${s.id}`}>
      <header className="border-b p-4 sm:p-5">
        <h3 id={`sc-${s.id}`} className="flex items-center gap-2 text-lg font-semibold">
          <Icon className="h-5 w-5 text-primary" aria-hidden /> {s.name}
        </h3>
        <p className="mt-1 text-sm">{s.summary}</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground">
          {s.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {s.requirements.map((r) => (
            <div key={r.label} className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span className="font-semibold">{r.label}: </span>
              {r.text}
            </div>
          ))}
        </div>
      </header>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Arquitectura</legend>
            {ARCHITECTURES.map((a) => (
              <label key={a.id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm focus-within:ring-2 focus-within:ring-ring', choice.architecture === a.id ? 'border-primary bg-primary/10' : 'hover:bg-accent')}>
                <input type="radio" name={archName} value={a.id} checked={choice.architecture === a.id} onChange={() => update({ architecture: a.id })} className="mt-1 accent-[hsl(var(--primary))]" />
                <span>
                  <span className="font-medium">{a.label}</span>
                  <span className="block text-xs text-muted-foreground">{a.desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <RadioRow
            legend={<Term k="privacyUnit">Unidad de privacidad</Term>}
            value={choice.unit}
            options={['record', 'client'] as const}
            labels={UNIT_LABELS}
            onChange={(u) => update({ unit: u })}
            disabled={!rel.dp}
            help={!rel.dp ? 'Solo aplica a arquitecturas con DP.' : undefined}
          />
          <RadioRow
            legend={
              <>
                Nivel de ruido (<Term k="epsilon">ε</Term> aproximado)
              </>
            }
            value={choice.noise}
            options={['none', 'low', 'medium', 'high'] as const}
            labels={NOISE_LABELS}
            onChange={(n) => update({ noise: n })}
            disabled={!rel.dp}
            help={!rel.dp ? 'Solo aplica a arquitecturas con DP.' : undefined}
          />
          <RadioRow
            legend={<Term k="participation">Participación de clientes por ronda</Term>}
            value={choice.participation}
            options={['low', 'medium', 'full'] as const}
            labels={PARTICIPATION_LABELS}
            onChange={(p) => update({ participation: p })}
            disabled={!rel.fl}
            help={!rel.fl ? 'Solo aplica a arquitecturas federadas.' : undefined}
          />
          <RadioRow
            legend={<Term k="localEpochs">Épocas locales</Term>}
            value={choice.epochs}
            options={['few', 'moderate', 'many'] as const}
            labels={EPOCHS_LABELS}
            onChange={(e) => update({ epochs: e })}
            disabled={!rel.fl}
            help={!rel.fl ? 'Solo aplica a arquitecturas federadas.' : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSubmitted(true)} disabled={!choice.architecture}>
              <ClipboardCheck /> Evaluar configuración
            </Button>
            <Button variant="ghost" onClick={() => { setChoice(DEFAULT_CHOICE); setSubmitted(false); }}>
              <RotateCcw /> Reiniciar
            </Button>
          </div>
        </div>
        <div aria-live="polite" className="space-y-3">
          {!evals ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {choice.architecture ? 'Pulsa «Evaluar configuración» para ver cómo se cumple cada requisito.' : 'Elige una arquitectura y sus ajustes, y pulsa «Evaluar configuración».'}
            </p>
          ) : (
            <>
              <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold', STATUS_UI[v!.status].cls)}>
                {(() => {
                  const I = STATUS_UI[v!.status].Icon;
                  return <I className="h-4 w-4" aria-hidden />;
                })()}
                {v!.label}
              </div>
              <ul className="space-y-2">
                {evals.map((e) => {
                  const ui = STATUS_UI[e.status];
                  return (
                    <li key={e.requirement} className="rounded-md border p-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{e.requirement}</span>
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', ui.cls)}>
                          <ui.Icon className="h-3 w-3" aria-hidden /> {ui.label}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{e.explanation}</p>
                    </li>
                  );
                })}
              </ul>
              <Callout kind="info" title="Solución razonada y matices">
                <ul className="list-disc space-y-1 pl-4">
                  {s.discussion.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </Callout>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export default function FinalChallenge() {
  const [state, setState, reset] = usePersistentState<ChallengeState>('quiz.final', EMPTY_CHALLENGE);
  const [active, setActive] = useState(SCENARIOS[0].id);
  const s = SCENARIOS.find((x) => x.id === active) ?? SCENARIOS[0];
  const evaluatedCount = SCENARIOS.filter((x) => state.submitted[x.id]).length;
  return (
    <section aria-labelledby="final-challenge" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="final-challenge" className="flex items-center gap-2 text-base font-semibold">
            <Lightbulb className="h-4 w-4 text-warn" aria-hidden /> Reto práctico final
          </h2>
          <p className="text-sm text-muted-foreground">Elige la configuración más adecuada para cada organización. Puede haber más de una respuesta aceptable: lo importante es justificar los compromisos.</p>
        </div>
        <div className="flex items-center gap-2">
          <IntegrityBadge kind="concept" />
          <Badge variant="secondary">
            {evaluatedCount}/{SCENARIOS.length} evaluados
          </Badge>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw /> Reiniciar reto
          </Button>
        </div>
      </div>
      <Callout kind="warn">
        La evaluación es un razonamiento cualitativo basado en reglas, no una simulación de estos sistemas. Los rangos de ε son orientativos: un valor de ε solo tiene sentido con un mecanismo concreto, una unidad de privacidad y un contador de privacidad válido.
      </Callout>
      <div role="tablist" aria-label="Organizaciones" className="flex flex-wrap gap-2">
        {SCENARIOS.map((x) => {
          const I = ICONS[x.id] ?? Building2;
          const sel = x.id === active;
          return (
            <button
              key={x.id}
              role="tab"
              type="button"
              id={`tab-${x.id}`}
              aria-selected={sel}
              aria-controls={`panel-${x.id}`}
              onClick={() => setActive(x.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const i = SCENARIOS.findIndex((y) => y.id === active);
                const n = SCENARIOS[(i + (e.key === 'ArrowRight' ? 1 : SCENARIOS.length - 1)) % SCENARIOS.length];
                setActive(n.id);
                document.getElementById(`tab-${n.id}`)?.focus();
              }}
              tabIndex={sel ? 0 : -1}
              className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors', sel ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}
            >
              <I className="h-4 w-4" aria-hidden /> {x.name}
              {state.submitted[x.id] && <CheckCircle2 className="h-3.5 w-3.5" aria-label="evaluado" />}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${s.id}`} aria-labelledby={`tab-${s.id}`}>
        <ScenarioCard
          key={s.id}
          s={s}
          choice={{ ...DEFAULT_CHOICE, ...state.choices[s.id] }}
          submitted={!!state.submitted[s.id]}
          setChoice={(c) => setState((st) => ({ ...st, choices: { ...st.choices, [s.id]: c } }))}
          setSubmitted={(v) => setState((st) => ({ ...st, submitted: { ...st.submitted, [s.id]: v } }))}
        />
      </div>
    </section>
  );
}
