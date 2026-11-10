import type { ReactNode } from 'react';
import { Bot, Brain, Database, FileWarning, Layers, ShieldAlert, ShieldCheck, Wrench, ArrowRight, CircleCheck, CircleX, Info, Ban } from 'lucide-react';
import { IntegrityBadge } from '@/components/lab/IntegrityBadge';
import { Callout, Reflection } from '@/components/lab/Blocks';
import { ParamSlider, ParamToggle } from '@/components/lab/ParamControl';
import { PrivacyModelCard } from '@/components/lab/PrivacyModel';
import { Term } from '@/components/lab/Term';
import { dpFedAvgSpec } from '@/lib/privacy/model';
import { usePersistentState } from '@/lib/store';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import {
  CONTROL_LABELS,
  EXTERNAL_ADDRESS,
  MEMORY_QUESTION_B,
  PATIENTS,
  REQUESTING_USER,
  simulateMemory,
  simulateToolScenario,
  singleControlMatrix,
  type MemoryPolicy,
  type StepKind,
  type ToolControls,
} from './simulation';

const MEMORY_DEFAULTS: MemoryPolicy = { perUserIsolation: false, noSensitivePersistence: false, limitedRetention: false, retentionDays: 30, elapsedDays: 10, modelTrainedWithDP: true };
const TOOL_DEFAULTS: ToolControls = { leastPrivilege: false, trustBoundary: false, egressControl: false, memoryIsolation: false, modelTrainedWithDP: true };

function Scenario({ n, icon, title, badges, children }: { n: number; icon: ReactNode; title: string; badges: ('concept' | 'sim')[]; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5" aria-labelledby={`esc-${n}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={`esc-${n}`} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {icon}
          <span>
            <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-primary">Escenario {n} ·</span> {title}
          </span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <IntegrityBadge key={b} kind={b} />
          ))}
        </div>
      </div>
      {children}
    </section>
  );
}

const STEP_STYLE: Record<StepKind, { cls: string; Icon: typeof Info }> = {
  ok: { cls: 'border-ok/40 bg-ok/5', Icon: CircleCheck },
  blocked: { cls: 'border-primary/40 bg-primary/5', Icon: Ban },
  danger: { cls: 'border-destructive/40 bg-destructive/5', Icon: CircleX },
  info: { cls: 'border-border bg-muted/40', Icon: Info },
};

const CONTROLS_EXPLAINED: { name: string; protects: string; notProtects: string }[] = [
  {
    name: 'DP en el entrenamiento (FL + DP-FedAvg)',
    protects: 'Acota cuánto revelan los parámetros publicados sobre la contribución de un cliente (o registro) de ENTRENAMIENTO, bajo los supuestos del contador.',
    notProtects: 'Lo que el usuario escribe, lo que guarda la memoria, lo que devuelve una herramienta, los registros (logs) ni las acciones del agente en inferencia.',
  },
  {
    name: 'Aislamiento de memoria por usuario',
    protects: 'Que las memorias de un usuario se recuperen en sesiones de otro, y que una inyección persista entre usuarios.',
    notProtects: 'Que el propio usuario (o un administrador, o una copia de seguridad) acceda a datos sensibles almacenados en claro.',
  },
  {
    name: 'No persistir datos sensibles / retención limitada',
    protects: 'Reduce cuánto dato sensible existe y durante cuánto tiempo: menos superficie expuesta.',
    notProtects: 'Fugas dentro de la ventana de retención; además tiene coste de utilidad (el agente "olvida").',
  },
  {
    name: 'Mínimo privilegio en herramientas',
    protects: 'Limita qué registros puede obtener el agente en nombre de un usuario (el alcance de un abuso).',
    notProtects: 'El abuso de los datos a los que el usuario SÍ tiene acceso (pueden seguir enviándose fuera).',
  },
  {
    name: 'Frontera de confianza (contenido de baja confianza = datos)',
    protects: 'Que instrucciones incrustadas en documentos, webs o correos se ejecuten como órdenes.',
    notProtects: 'En sistemas reales basados en LLM la separación es imperfecta: la inyección de instrucciones sigue siendo un problema abierto. Aquí se SUPONE aplicada por la arquitectura.',
  },
  {
    name: 'Control de salida / confirmación humana',
    protects: 'Que los datos salgan hacia destinos no autorizados sin que una persona lo apruebe.',
    notProtects: 'Que los datos entren innecesariamente en el contexto del agente o en sus registros; ni a un humano que aprueba sin revisar.',
  },
];

export default function Agentic() {
  const [mem, setMem] = usePersistentState<MemoryPolicy>('agentic.memory', MEMORY_DEFAULTS);
  const [tools, setTools] = usePersistentState<ToolControls>('agentic.tools', TOOL_DEFAULTS);
  const memOut = simulateMemory(mem);
  const toolOut = simulateToolScenario(tools);
  const matrix = singleControlMatrix();
  const setM = (p: Partial<MemoryPolicy>) => setMem((prev) => ({ ...prev, ...p }));
  const setT = (p: Partial<ToolControls>) => setTools((prev) => ({ ...prev, ...p }));

  return (
    <article className="space-y-4" aria-labelledby="agentic-title">
      <header className="rounded-lg border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Extensión educativa</p>
        <h1 id="agentic-title" className="mt-1 text-2xl font-semibold tracking-tight">
          Más allá del modelo: privacidad en IA agéntica
        </h1>
        <p className="text-sm text-muted-foreground">(Beyond the Model: Privacy in Agentic AI)</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <IntegrityBadge kind="concept" />
          <IntegrityBadge kind="sim" />
        </div>
        <div className="prose-lab mt-3 max-w-4xl">
          <p>
            Hasta ahora hemos protegido el <strong>entrenamiento</strong> de un modelo: Privacidad Diferencial para acotar lo que los parámetros revelan, Aprendizaje Federado para que los datos brutos no
            salgan de cada hospital. Un <strong>agente</strong> es un sistema más amplio: usa un modelo, pero además <strong>guarda memoria</strong>, <strong>llama a herramientas</strong> con acceso a datos
            privados y <strong>lee contenido</strong> de distinta confianza (correos, webs, documentos).
          </p>
          <p>
            Esta página es una simulación <strong>determinista y basada en reglas</strong>: no hay ningún modelo de lenguaje, ni llamadas a servicios externos, y todos los pacientes son sintéticos. Sirve para
            seguir el flujo de datos, no para medir la seguridad de un agente real.
          </p>
        </div>
        <div className="mt-4 rounded-lg border-2 border-primary/50 bg-primary/5 p-4 text-center">
          <p className="text-lg font-semibold leading-snug">La privacidad a nivel de modelo no implica automáticamente privacidad a nivel de sistema.</p>
          <p className="mt-1 text-xs text-muted-foreground">Model-level privacy does not automatically imply system-level privacy.</p>
        </div>
      </header>

      <Scenario n={1} icon={<Layers className="h-5 w-5 text-dp" aria-hidden />} title="Entrenamiento con preservación de privacidad" badges={['concept']}>
        <p className="text-sm leading-relaxed">
          La red de hospitales entrena el modelo que usará el agente con Aprendizaje Federado y DP-FedAvg a <Term k="privacyUnit">nivel de cliente</Term>, como en el{' '}
          <a className="text-primary underline-offset-2 hover:underline" href={href('/combined')}>
            experimento combinado
          </a>
          . Bajo sus supuestos, la garantía acota cuánto pueden cambiar los <strong>modelos publicados</strong> si se añade o elimina la contribución completa de un hospital.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Callout kind="ok" title="Qué protege">
            <ul className="list-disc space-y-1 pl-4">
              <li>La influencia de los datos de entrenamiento de un cliente sobre los parámetros publicados (ε, δ acotados bajo los supuestos).</li>
              <li>Frente a observadores del modelo final: ataques de inferencia de pertenencia o de reconstrucción sobre el entrenamiento.</li>
              <li>Con FL, los registros brutos no se centralizan durante el entrenamiento.</li>
            </ul>
          </Callout>
          <Callout kind="warn" title="Qué NO protege">
            <ul className="list-disc space-y-1 pl-4">
              <li>Las entradas en tiempo de inferencia (prompts, documentos que lee el agente) ni sus salidas.</li>
              <li>La memoria persistente del agente y los registros (logs) del sistema.</li>
              <li>Los datos que devuelven las herramientas: son registros exactos de una base de datos, no parámetros entrenados.</li>
              <li>El servidor de agregación de confianza (con DP central ve cada actualización).</li>
            </ul>
          </Callout>
        </div>
        <PrivacyModelCard spec={dpFedAvgSpec('add-remove')} compact />
      </Scenario>

      <Scenario n={2} icon={<Brain className="h-5 w-5 text-fl" aria-hidden />} title="Memoria del agente" badges={['sim', 'concept']}>
        <p className="text-sm leading-relaxed">
          La Dra. Ruiz (usuario A) pide al agente que <em>recuerde</em> datos clínicos de un paciente sintético. Días después, otro usuario (B), sin relación con ese paciente, pregunta por él. La memoria
          guarda el texto <strong>tal cual</strong>, fuera del entrenamiento: la garantía DP del modelo no interviene en absoluto.
        </p>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Políticas de memoria</legend>
            <ParamToggle label="Aislamiento por usuario" checked={mem.perUserIsolation} onChange={(v) => setM({ perUserIsolation: v })} help="Cada usuario solo recupera sus memorias." />
            <ParamToggle label="No persistir datos sensibles" checked={mem.noSensitivePersistence} onChange={(v) => setM({ noSensitivePersistence: v })} help="Los datos clínicos se redactan antes de guardar." />
            <ParamToggle label="Retención limitada" checked={mem.limitedRetention} onChange={(v) => setM({ limitedRetention: v })} help={`Las memorias caducan a los ${mem.retentionDays} días.`} />
            <ParamSlider label="Días entre la sesión de A y la de B" ariaLabel="Días transcurridos" value={mem.elapsedDays} min={0} max={90} step={1} onChange={(v) => setM({ elapsedDays: v })} />
            <ParamToggle
              label="Modelo base entrenado con DP"
              checked={mem.modelTrainedWithDP}
              onChange={(v) => setM({ modelTrainedWithDP: v })}
              help="Cámbialo: el resultado no varía, porque la memoria no forma parte del entrenamiento."
            />
            {!mem.perUserIsolation && !mem.noSensitivePersistence && !mem.limitedRetention && <p className="text-[11px] text-warn">Sin políticas activas = memoria compartida global.</p>}
          </fieldset>
          <div className="min-w-0 space-y-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[520px] text-xs">
                <caption className="border-b bg-muted/50 px-3 py-1.5 text-left font-semibold">
                  <Database className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Almacén de memoria del agente
                </caption>
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="px-2 py-1 text-left font-medium">Propietario</th>
                    <th scope="col" className="px-2 py-1 text-left font-medium">Contenido guardado</th>
                    <th scope="col" className="px-2 py-1 text-left font-medium">¿Visible para B?</th>
                  </tr>
                </thead>
                <tbody>
                  {memOut.entries.map((e, i) => (
                    <tr key={i} className="border-b align-top last:border-0">
                      <td className="px-2 py-1.5">
                        {e.ownerLabel}
                        {e.sensitive && <span className="ml-1 rounded bg-destructive/10 px-1 text-[10px] text-destructive">sensible</span>}
                      </td>
                      <td className={cn('px-2 py-1.5', e.expired && 'text-muted-foreground line-through')}>{e.stored}</td>
                      <td className="px-2 py-1.5">
                        <span className={cn('font-semibold', e.visibleToB ? 'text-destructive' : 'text-ok')}>{e.visibleToB ? 'Sí' : 'No'}</span>
                        <span className="block text-muted-foreground">{e.why}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                <strong>Usuario B:</strong> «{MEMORY_QUESTION_B}»
              </p>
              <p className="flex gap-2">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <strong>Agente:</strong> «{memOut.answerToB}»
                </span>
              </p>
            </div>
            <div aria-live="polite">
              {memOut.leaked ? (
                <Callout kind="danger" title="Fuga entre usuarios">
                  B ha recibido {memOut.leakedFacts.join(', ')} de un paciente con el que no tiene relación. {mem.modelTrainedWithDP && 'El modelo se entrenó con DP y eso no ha cambiado nada: estos datos nunca pasaron por el entrenamiento.'}
                </Callout>
              ) : (
                <Callout kind="ok" title="Sin fuga hacia B en esta configuración">
                  Lo ha evitado una política de <strong>sistema</strong> (memoria), no la privacidad del modelo.
                </Callout>
              )}
              {memOut.utilityNote && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <strong>Contrapartida:</strong> {memOut.utilityNote}
                </p>
              )}
            </div>
          </div>
        </div>
      </Scenario>

      <Scenario n={3} icon={<Wrench className="h-5 w-5 text-warn" aria-hidden />} title="Exposición de datos mediante herramientas" badges={['sim', 'concept']}>
        <p className="text-sm leading-relaxed">
          El agente tiene una herramienta autorizada, <code className="num rounded bg-muted px-1">consultar_historial(paciente)</code>, sobre una base de datos privada sintética, y otra para{' '}
          <code className="num rounded bg-muted px-1">enviar_correo</code>. {REQUESTING_USER.name} le pide resumir una carta de derivación recibida por correo. La carta (contenido de <strong>baja confianza</strong>)
          esconde una instrucción maliciosa que pide enviar todos los historiales a <span className="num">{EXTERNAL_ADDRESS}</span>.
        </p>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Controles del sistema</legend>
            <ParamToggle label={CONTROL_LABELS.leastPrivilege} checked={tools.leastPrivilege} onChange={(v) => setT({ leastPrivilege: v })} help="La herramienta usa los permisos del usuario solicitante." />
            <ParamToggle label={CONTROL_LABELS.trustBoundary} checked={tools.trustBoundary} onChange={(v) => setT({ trustBoundary: v })} help="El contenido de baja confianza se trata como datos, no como instrucciones." />
            <ParamToggle label={CONTROL_LABELS.egressControl} checked={tools.egressControl} onChange={(v) => setT({ egressControl: v })} help="Destinos externos solo con lista blanca o aprobación humana." />
            <ParamToggle label={CONTROL_LABELS.memoryIsolation} checked={tools.memoryIsolation} onChange={(v) => setT({ memoryIsolation: v })} help="Nada de esta sesión persiste ni se comparte entre usuarios." />
            <ParamToggle label={CONTROL_LABELS.modelTrainedWithDP} checked={tools.modelTrainedWithDP} onChange={(v) => setT({ modelTrainedWithDP: v })} help="Prueba a activarlo y desactivarlo: compara el resultado." />
          </fieldset>
          <div className="min-w-0 space-y-3">
            <ol className="space-y-1.5" aria-label="Traza de ejecución del agente simulado">
              {toolOut.trace.map((s, i) => {
                const st = STEP_STYLE[s.kind];
                return (
                  <li key={i} className={cn('flex gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed', st.cls)}>
                    <st.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      <span className="mr-1 font-semibold">{i + 1}. {s.actor}:</span>
                      {s.text}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div aria-live="polite">
              {toolOut.exfiltrated.length > 0 ? (
                <Callout kind="danger" title={`Exfiltración: ${toolOut.exfiltrated.length} historiales enviados a ${EXTERNAL_ADDRESS}`}>
                  Pacientes afectados: {toolOut.exfiltrated.join(', ')}.{' '}
                  {tools.modelTrainedWithDP && 'El modelo está entrenado con DP, y aun así: la DP acota lo que revelan los parámetros entrenados, no lo que una herramienta devuelve en tiempo de inferencia.'}
                </Callout>
              ) : toolOut.overCollected.length > 0 ? (
                <Callout kind="warn" title="No hay envío externo, pero sí sobreexposición">
                  El agente obtuvo {toolOut.overCollected.length} historiales que la tarea no requería ({toolOut.overCollected.join(', ')}). Quedan en su contexto y posiblemente en registros (logs).
                </Callout>
              ) : (
                <Callout kind="ok" title="Sin exfiltración en esta configuración">
                  La instrucción incrustada no se ejecutó. Recuerda: aquí la frontera de confianza se <strong>supone</strong> perfecta; en agentes reales basados en LLM no lo es.
                </Callout>
              )}
              {toolOut.injectionPersisted && <p className="mt-2 text-xs text-destructive">Además, la inyección quedó en la memoria compartida y podría afectar a otros usuarios.</p>}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <caption className="mb-1 text-left text-sm font-medium">Cada control por separado (calculado con la misma simulación)</caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="py-1 pr-2 text-left font-medium">Configuración</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Historiales exfiltrados</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Obtenidos sin necesidad</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Inyección persistida</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.label} className={cn('border-b', r.controls.modelTrainedWithDP && !r.controls.trustBoundary && 'bg-dp/5')}>
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    {r.label}
                  </th>
                  <td className={cn('num px-2 py-1 text-right', r.outcome.exfiltrated.length ? 'text-destructive' : 'text-ok')}>
                    {r.outcome.exfiltrated.length} / {PATIENTS.length}
                  </td>
                  <td className="num px-2 py-1 text-right">{r.outcome.overCollected.length}</td>
                  <td className="px-2 py-1 text-right">{r.outcome.injectionPersisted ? 'sí' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-muted-foreground">
            La fila «Solo: Entrenar el modelo con DP» es idéntica a «Ningún control». Ningún control aislado lo resuelve todo y la lista no es exhaustiva: la defensa debe ser en profundidad (también
            auditoría, cifrado, gestión de identidades, revisión humana, pruebas adversarias…).
          </p>
        </div>
      </Scenario>

      <section className="rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="controls-title">
        <h2 id="controls-title" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5 text-ok" aria-hidden /> Qué protege cada control
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="py-1 pr-2 text-left font-medium">Control</th>
                <th scope="col" className="px-2 py-1 text-left font-medium text-ok">Protege</th>
                <th scope="col" className="px-2 py-1 text-left font-medium text-warn">No protege</th>
              </tr>
            </thead>
            <tbody>
              {CONTROLS_EXPLAINED.map((c) => (
                <tr key={c.name} className="border-b align-top">
                  <th scope="row" className="py-1.5 pr-2 text-left font-semibold">
                    {c.name}
                  </th>
                  <td className="px-2 py-1.5 leading-relaxed">{c.protects}</td>
                  <td className="px-2 py-1.5 leading-relaxed">{c.notProtects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Callout kind="info" title="Contexto: FATE-LLM">
          FATE-LLM forma parte del ecosistema de código abierto FATE (Federated AI Technology Enabler) de la comunidad FedAI. Es un ejemplo de marco orientado al entrenamiento federado y con preservación
          de privacidad de grandes modelos de lenguaje, incluidos escenarios de ajuste fino e inferencia. Se menciona solo como referencia: este laboratorio no lo integra, y un marco así protege (bajo sus
          propios supuestos) el entrenamiento o la inferencia del modelo, pero <strong>no proporciona por sí mismo seguridad de extremo a extremo de un agente</strong>: memoria, permisos de herramientas,
          fronteras de confianza y controles de salida siguen dependiendo del diseño del sistema.
        </Callout>
        <Callout kind="warn" title="Lo que esta página NO demuestra">
          <ul className="list-disc space-y-1 pl-4">
            <li>No hay un LLM: el agente sigue reglas fijas, así que no mide la robustez real frente a inyección de instrucciones.</li>
            <li>Los controles se suponen correctamente implementados; en la práctica pueden fallar o eludirse.</li>
            <li>No es un marco de seguridad para agentes ni un análisis de amenazas completo.</li>
          </ul>
          <a href={href('/limits')} className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Limitaciones del laboratorio <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </Callout>
      </section>

      <Callout kind="danger" title="Idea central">
        <span className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
          <span>
            La privacidad a nivel de modelo no implica automáticamente privacidad a nivel de sistema. La DP y el FL responden a «¿qué revelan los parámetros entrenados sobre los datos de entrenamiento?»; un
            agente plantea además «¿qué guarda, qué puede consultar, a quién obedece y a dónde puede enviar datos?».
          </span>
        </span>
      </Callout>

      <Reflection
        experimentId="agentic"
        question="Un hospital te dice: «Nuestro asistente es privado porque su modelo se entrenó con Aprendizaje Federado y DP (ε = 2)». ¿Qué preguntas harías sobre la memoria, las herramientas y las fronteras de confianza antes de aceptar esa afirmación?"
        hint="Piensa en: quién puede recuperar qué memorias y durante cuánto tiempo; con qué permisos se ejecutan las herramientas; qué contenido puede dar órdenes al agente; a qué destinos puede enviar datos; qué queda en los registros. Y recuerda: ε = 2 describe el entrenamiento, no estas rutas."
      />
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <FileWarning className="h-3.5 w-3.5" aria-hidden /> Todos los datos de esta página son sintéticos y ficticios.
      </p>
    </article>
  );
}
