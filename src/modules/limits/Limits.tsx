import { ShieldQuestion } from 'lucide-react';
import { IntegrityBadge, INTEGRITY } from '@/components/lab/IntegrityBadge';
import type { GuaranteeKind } from '@/lib/runs';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Sobre la Privacidad Diferencial',
    items: [
      'La DP no es anonimato perfecto: limita cuánto puede cambiar la distribución de resultados al modificar a UNA unidad protegida, pero no impide aprender hechos generales sobre la población (que también pueden afectar a las personas).',
      'Los mecanismos de este laboratorio usan un generador pseudoaleatorio con semilla (Mulberry32) para que los experimentos sean reproducibles. Ese generador NO es seguro: un despliegue real requiere aleatoriedad criptográficamente segura.',
      'Las implementaciones ingenuas de Laplace/Gauss en punto flotante pueden filtrar información por los bits menos significativos (Mironov, 2012). Las bibliotecas de producción usan técnicas como el snapping mechanism o muestreo discreto. Aquí no se implementan.',
      'El ε calculado para DP-SGD y DP-FedAvg es una cota conservadora mediante RDP SIN amplificación por submuestreo, y solo se muestra en modo lote completo / participación total. Con mini-lotes o participación parcial se muestra «No calculado».',
      'Las garantías dependen del mecanismo completo: preprocesamiento, límites públicos, selección de hiperparámetros, número de ejecuciones y todo lo que se publique. Ajustar hiperparámetros mirando los datos privados también consume privacidad y aquí no se contabiliza.',
      'Las semillas no reponen el presupuesto: si un analista ejecuta la misma consulta con otra semilla, gasta presupuesto adicional.',
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
    ],
  },
  {
    title: 'Sobre los resultados en general',
    items: [
      'Las precisiones y pérdidas son observaciones empíricas sobre datos sintéticos pequeños; no predicen el rendimiento de sistemas reales.',
      'Los datos son ficticios y generados en el navegador; no representan pacientes ni personas reales.',
      'Las animaciones ilustran flujos de información; una animación «exitosa» no demuestra que un sistema sea seguro.',
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
    </div>
  );
}
