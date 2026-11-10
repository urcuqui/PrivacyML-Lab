import { ShieldQuestion, Bot } from 'lucide-react';
import { href } from '@/lib/router';
import { IntegrityBadge, INTEGRITY } from '@/components/lab/IntegrityBadge';
import type { GuaranteeKind } from '@/lib/runs';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Reproducibilidad educativa frente a privacidad en producción',
    items: [
      'Reproducibilidad educativa: los mecanismos usan un PRNG determinista con semilla (Mulberry32, 32 bits) para que una clase entera pueda repetir exactamente el mismo experimento. Su salida es predecible a partir de la semilla (que además se muestra): NUNCA es adecuado para privacidad diferencial en producción.',
      'Privacidad en producción exige: aleatoriedad criptográficamente segura, muestreadores validados y resistentes a ataques de implementación (mecanismos discretos de Laplace/Gauss, snapping mechanism, muestreo exacto), supuestos formalmente justificados (sensibilidad, vecindad, contabilidad) y protección frente a fugas por tiempo de ejecución o por los bits menos significativos.',
      'El laboratorio incluye createCryptoRng (basado en crypto.getRandomValues), pero NO es apto para producción: sigue muestreando Laplace (inversión de la CDF) y Gauss (Box–Muller) en punto flotante, donde los «huecos» entre valores representables pueden revelar el valor exacto (Mironov, 2012).',
      'Sustituir el PRNG con semilla por uno criptográfico NO hace seguro un mecanismo en punto flotante. Un despliegue real debe usar bibliotecas de DP validadas (p. ej. OpenDP, la biblioteca de DP de Google, Opacus o TF Privacy con su contador).',
      'Las semillas no reponen el presupuesto: si un analista ejecuta la misma consulta con otra semilla, gasta presupuesto adicional.',
    ],
  },
  {
    title: 'Sobre la Privacidad Diferencial',
    items: [
      'La DP no es anonimato perfecto: limita cuánto puede cambiar la distribución de resultados al modificar a UNA unidad protegida, pero no impide aprender hechos generales sobre la población (que también pueden afectar a las personas).',
      'Las implementaciones ingenuas de Laplace/Gauss en punto flotante pueden filtrar información por los bits menos significativos (Mironov, 2012). Las bibliotecas de producción usan técnicas como el snapping mechanism o muestreo discreto. Aquí no se implementan.',
      'El ε calculado para DP-SGD y DP-FedAvg es una cota conservadora mediante RDP SIN amplificación por submuestreo. Depende de la vecindad elegida: con añadir/eliminar (sensibilidad C) solo se calcula con lote completo (DP-SGD) o participación total (DP-FedAvg); con reemplazo (n o K públicos, sensibilidad 2C) también se calcula con mini-lotes (⌈T/⌊n/B⌋⌉ composiciones por registro) o participación parcial (peor caso: T rondas). En cualquier otro caso se muestra «No calculado».',
      'Las métricas de entrenamiento que se muestran (pérdida y precisión de entrenamiento, precisión local por cliente, fracción de recorte, actualizaciones individuales) se calculan sin ruido sobre datos privados: son instrumentación didáctica y NO están cubiertas por la garantía.',
      'La DP central en DP-FedAvg (el servidor recorta y añade el ruido) protege frente a observadores de los modelos publicados, NO frente al servidor de agregación, que ve cada actualización individual.',
      'Las garantías dependen del mecanismo completo: preprocesamiento, límites públicos, selección de hiperparámetros, número de ejecuciones y todo lo que se publique. Ajustar hiperparámetros mirando los datos privados también consume privacidad y aquí no se contabiliza.',
    ],
  },
  {
    title: 'Sobre el Aprendizaje Federado',
    items: [
      'Los «hospitales» son clientes simulados dentro de tu navegador. No hay red, ni latencia, ni fallos de clientes, ni clientes maliciosos, ni bizantinos.',
      'El modelo es una regresión logística con 3 parámetros sobre 2 características sintéticas. Las dinámicas de redes profundas (no convexas, millones de parámetros) pueden ser muy distintas.',
      'El coste de comunicación cuenta solo bytes de parámetros (float32). No incluye cabeceras, cifrado, compresión, cuantización, reintentos ni asimetría de ancho de banda.',
      'La ilustración de fuga por gradientes es un cálculo analítico sobre un modelo lineal; no es un ataque de reconstrucción completo (como Deep Leakage from Gradients) ni demuestra su eficacia en modelos reales.',
      'La agregación segura se muestra solo de forma conceptual: no se implementa ningún protocolo criptográfico (máscaras por pares, gestión de abandonos, etc.).',
      'Los resultados IID vs Non-IID dependen de cómo se generan los datos sintéticos. No implican que los datos no-IID empeoren siempre el resultado.',
      'El conjunto de evaluación de referencia común (clases equilibradas, sin desplazamiento) coincide con la distribución de entrenamiento del escenario IID: es una elección explícita de población objetivo que puede favorecer al escenario IID.',
    ],
  },
  {
    title: 'Sobre los resultados en general',
    items: [
      'Las precisiones y pérdidas son observaciones empíricas sobre datos sintéticos pequeños; no predicen el rendimiento de sistemas reales.',
      'Los datos son ficticios y generados en el navegador; no representan pacientes ni personas reales.',
      'Las animaciones ilustran flujos de información; una animación «exitosa» no demuestra que un sistema sea seguro.',
      'Las descomposiciones empíricas (p. ej. qué parte de la pérdida de precisión se debe a la ponderación, al recorte o al ruido) son observaciones sobre esta configuración y semilla, con un orden secuencial concreto; no son garantías causales generales.',
      'La privacidad a nivel de modelo no implica privacidad a nivel de sistema: memoria, herramientas y fronteras de confianza de un agente quedan fuera de las garantías de DP y FL (ver «Más allá del modelo»).',
      'Este laboratorio no evalúa amenazas como ataques de inferencia de pertenencia sobre el modelo final, envenenamiento de modelos, ni cumplimiento normativo (RGPD, HIPAA…).',
    ],
  },
];

export default function Limits() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="rounded-lg border bg-card p-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldQuestion className="h-6 w-6 text-primary" aria-hidden /> Lo que esta simulación NO demuestra
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          La integridad científica exige separar con claridad lo que se calcula, lo que se garantiza matemáticamente, lo que se observa empíricamente y lo que solo se ilustra. Esta página recoge las
          limitaciones del laboratorio.
        </p>
      </header>
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Etiquetas de integridad usadas en el laboratorio</h2>
        <ul className="space-y-2">
          {(Object.keys(INTEGRITY) as GuaranteeKind[]).map((k) => (
            <li key={k} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
              <span className="shrink-0 sm:w-56">
                <IntegrityBadge kind={k} />
              </span>
              <span className="text-sm leading-relaxed">{INTEGRITY[k].desc}</span>
            </li>
          ))}
        </ul>
      </section>
      {SECTIONS.map((s) => (
        <section key={s.title} className="rounded-lg border bg-card p-5">
          <h2 className="mb-2 text-base font-semibold">{s.title}</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {s.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
      <a href={href('/agentic')} className="flex items-center gap-2 rounded-lg border border-dashed bg-card p-4 text-sm hover:bg-accent">
        <Bot className="h-4 w-4 text-primary" aria-hidden />
        <span>
          <strong>Más allá del modelo:</strong> por qué la privacidad a nivel de modelo no implica privacidad a nivel de sistema en agentes de IA (memoria, herramientas, fronteras de confianza).
        </span>
      </a>
    </div>
  );
}
