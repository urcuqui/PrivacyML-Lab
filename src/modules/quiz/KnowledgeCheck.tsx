import { useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw, GraduationCap, BookOpen, Calculator, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/lab/Blocks';
import { usePersistentState } from '@/lib/store';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { QUESTIONS, MODULE_TITLES, EMPTY_QUIZ, scoreQuiz, type QuizModule, type QuizQuestion, type QuizState } from './questions';
import FinalChallenge from './FinalChallenge';

function QuestionCard({ q, index, answer, onAnswer }: { q: QuizQuestion; index: number; answer?: string; onAnswer: (optionId: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const chosen = q.options.find((o) => o.id === answer);
  const name = `q-${q.id}`;
  return (
    <li className="rounded-lg border bg-card p-4 sm:p-5">
      <fieldset>
        <legend className="mb-3 w-full">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="num text-xs font-semibold text-muted-foreground">Pregunta {index + 1}</span>
            <Badge variant="secondary">{q.concept}</Badge>
            {q.computed && (
              <Badge variant="ok" title="Los valores numéricos se calculan con el motor del laboratorio">
                <Calculator className="h-3 w-3" aria-hidden /> Valores calculados
              </Badge>
            )}
          </div>
          <span className="block text-[0.95rem] font-medium leading-relaxed">{q.prompt}</span>
          {q.context && <span className="formula mt-2">{q.context}</span>}
        </legend>
        <div className="space-y-2">
          {q.options.map((o) => {
            const isChosen = o.id === answer;
            const reveal = !!answer;
            return (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
                  !reveal && 'hover:bg-accent focus-within:ring-2 focus-within:ring-ring',
                  reveal && o.correct && 'border-ok/60 bg-ok/10',
                  reveal && isChosen && !o.correct && 'border-destructive/60 bg-destructive/10',
                  reveal && 'cursor-default',
                )}
              >
                <input type="radio" name={name} value={o.id} checked={isChosen} disabled={reveal} onChange={() => onAnswer(o.id)} className="mt-1 accent-[hsl(var(--primary))]" />
                <span className="flex-1 leading-relaxed">
                  <span className="num mr-1 font-semibold uppercase">{o.id})</span>
                  {o.text}
                </span>
                {reveal && o.correct && <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-label="Respuesta correcta" />}
                {reveal && isChosen && !o.correct && <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Tu respuesta, incorrecta" />}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div aria-live="polite" className="mt-3">
        {chosen && (
          <div className="space-y-2">
            <Callout kind={chosen.correct ? 'ok' : 'danger'} title={chosen.correct ? 'Correcto' : 'No es correcto'}>
              {chosen.explanation}
              {!chosen.correct && (
                <p className="mt-1">
                  <strong>Respuesta correcta:</strong> {q.options.find((o) => o.correct)?.explanation}
                </p>
              )}
            </Callout>
            <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Ocultar explicación de cada opción' : 'Ver por qué cada opción es correcta o incorrecta'}
            </button>
            {showAll && (
              <ul className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                {q.options.map((o) => (
                  <li key={o.id}>
                    <span className={cn('font-semibold', o.correct ? 'text-ok' : 'text-muted-foreground')}>
                      {o.id.toUpperCase()}) {o.correct ? 'Correcta' : 'Incorrecta'}:
                    </span>{' '}
                    {o.explanation}
                  </li>
                ))}
              </ul>
            )}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">Para profundizar:</span>
              {q.learnMore.map((l) => (
                <a key={l.path + l.label} href={href(l.path)} className="text-primary underline-offset-2 hover:underline">
                  {l.label}
                </a>
              ))}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

function ModuleQuiz({ module }: { module: QuizModule }) {
  const [state, setState, reset] = usePersistentState<QuizState>(`quiz.${module}`, EMPTY_QUIZ);
  const qs = QUESTIONS[module];
  const score = scoreQuiz(module, state);
  const done = score.answered === score.total;
  const next: Record<QuizModule, { label: string; path: string }> = {
    dp: { label: 'Módulo 2 — Aprendizaje Federado', path: '/fl/1' },
    fl: { label: 'Módulo 3 — Experimento combinado', path: '/combined' },
    combined: { label: 'Reto práctico final', path: '/quiz' },
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="rounded-lg border bg-card p-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GraduationCap className="h-6 w-6 text-primary" aria-hidden /> Comprobación de conocimientos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{MODULE_TITLES[module]}</p>
        <p className="mt-2 text-sm leading-relaxed">
          Preguntas de razonamiento aplicado. Al responder verás por qué tu opción es correcta o incorrecta y podrás revisar la explicación de todas las opciones. Se puntúa el primer intento; tu progreso se guarda en este navegador.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <div className="mb-1 flex justify-between text-xs">
              <span>
                Respondidas {score.answered}/{score.total}
              </span>
              <span className="num font-semibold" aria-live="polite">
                Aciertos: {score.correct}/{score.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Progreso del cuestionario" aria-valuemin={0} aria-valuemax={score.total} aria-valuenow={score.answered}>
              <div className="h-full bg-primary transition-all" style={{ width: `${(100 * score.answered) / score.total}%` }} />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={reset} disabled={score.answered === 0}>
            <RotateCcw /> Reiniciar cuestionario
          </Button>
        </div>
      </header>
      <ol className="space-y-3">
        {qs.map((q, i) => (
          <QuestionCard key={q.id} q={q} index={i} answer={state.answers[q.id]} onAnswer={(opt) => setState((s) => (s.answers[q.id] ? s : { answers: { ...s.answers, [q.id]: opt } }))} />
        ))}
      </ol>
      {done && (
        <Callout kind={score.correct === score.total ? 'ok' : 'info'} title={`Resultado: ${score.correct} de ${score.total}`}>
          {score.correct === score.total
            ? 'Excelente. Has razonado correctamente todos los conceptos del módulo.'
            : 'Revisa las explicaciones y los experimentos enlazados de las preguntas falladas, y vuelve a intentarlo cuando quieras.'}{' '}
          <a href={href(next[module].path)} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
            Continuar: {next[module].label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </Callout>
      )}
    </div>
  );
}

function ScoreCard({ module }: { module: QuizModule }) {
  const [state] = usePersistentState<QuizState>(`quiz.${module}`, EMPTY_QUIZ);
  const s = scoreQuiz(module, state);
  return (
    <a href={href(`/quiz/${module}`)} className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent">
      <p className={cn('text-xs font-semibold uppercase tracking-wider', module === 'dp' ? 'text-dp' : module === 'fl' ? 'text-fl' : 'text-primary')}>{MODULE_TITLES[module]}</p>
      <p className="num mt-1 text-2xl font-semibold">
        {s.correct}/{s.total}
      </p>
      <p className="text-xs text-muted-foreground">{s.answered === 0 ? 'Sin empezar' : s.answered < s.total ? `${s.answered} de ${s.total} respondidas` : 'Completado'}</p>
    </a>
  );
}

export default function KnowledgeCheck({ module = 'final' }: { module?: QuizModule | 'final' }) {
  if (module !== 'final') return <ModuleQuiz module={module} />;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-lg border bg-card p-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GraduationCap className="h-6 w-6 text-primary" aria-hidden /> Evaluación
        </h1>
        <p className="mt-2 text-sm leading-relaxed">
          Comprueba lo aprendido en cada módulo y termina con un reto práctico: elegir una arquitectura de ML con preservación de privacidad para organizaciones ficticias con requisitos explícitos de precisión, privacidad y comunicación.
        </p>
      </header>
      <section aria-labelledby="quiz-overview">
        <h2 id="quiz-overview" className="mb-2 text-base font-semibold">
          Cuestionarios por módulo
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <ScoreCard module="dp" />
          <ScoreCard module="fl" />
          <ScoreCard module="combined" />
        </div>
      </section>
      <FinalChallenge />
    </div>
  );
}
