import type { ExperimentRun } from './runs';
import { describeAdjacency, describeUnit } from './runs';
import { readState } from './store';
import { GENERAL_LIMITATIONS } from './privacy/model';

export function fmtVal(v: unknown): string {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    // Valores pequeños (p. ej. δ = 1e-5) en notación científica: nunca redondear a 0.
    if (v !== 0 && Math.abs(v) < 1e-3) return Number(v.toPrecision(3)).toExponential();
    return v.toLocaleString('es-ES', { maximumFractionDigits: 4 });
  }
  if (v === null || v === undefined) return '—';
  return String(v);
}

/** Sección "Modelo de privacidad" de una ejecución (nunca se omite). */
export function privacySection(r: ExperimentRun): string[] {
  const lines: string[] = ['### Modelo de privacidad', ''];
  const p = r.privacy;
  if (!p) {
    lines.push(
      r.privacyGuarantee
        ? r.privacyGuarantee
        : 'Esta ejecución no aplica un mecanismo de privacidad diferencial con contabilidad: **no se establece ninguna garantía formal de privacidad**.',
      '',
    );
    return lines;
  }
  lines.push(`- **Mecanismo:** ${p.mechanism}`);
  lines.push(`- **Unidad de privacidad:** ${describeUnit(p.unit)}`);
  lines.push(`- **Vecindad (adjacency):** ${describeAdjacency(p.adjacency)}`);
  lines.push(`- **Sensibilidad:** ${p.sensitivity}`);
  lines.push(`- **Ruido:** ${p.noise}`);
  if (p.clipNorm !== null) lines.push(`- **Norma de recorte C:** ${fmtVal(p.clipNorm)}`);
  if (p.noiseMultiplier !== null) lines.push(`- **Multiplicador de ruido σ:** ${fmtVal(p.noiseMultiplier)}`);
  lines.push(`- **Modelo de confianza:** ${p.trustModel}`);
  if (p.status === 'computed') lines.push(`- **Garantía:** (ε, δ) = (${fmtVal(p.epsilon)}, ${fmtVal(p.delta)}) — garantía formal BAJO los supuestos siguientes.`);
  else if (p.status === 'pure') lines.push(`- **Garantía:** ε = ${fmtVal(p.epsilon)} (ε-DP puro por publicación) bajo los supuestos indicados.`);
  else lines.push(`- **Garantía:** No calculado. Motivo: ${p.reason ?? 'no hay un método de contabilidad válido para esta configuración.'}`);
  if (p.accountantAssumptions.length) {
    lines.push('', '**Supuestos del contador de privacidad:**', '');
    p.accountantAssumptions.forEach((a) => lines.push(`- ${a}`));
  }
  if (p.outsideGuarantee.length) {
    lines.push('', '**Salidas mostradas que NO están cubiertas por la garantía:**', '');
    p.outsideGuarantee.forEach((a) => lines.push(`- ${a}`));
  }
  lines.push('');
  return lines;
}

/** Informe educativo conciso en Markdown (exportación 100 % en el cliente). */
export function buildReport(runs: ExperimentRun[]): string {
  const lines: string[] = [];
  lines.push('# Informe — Privacy-Preserving ML Lab', '');
  lines.push(`Generado: ${new Date().toLocaleString('es-ES')}`, '');
  lines.push('> Todos los datos son sintéticos. La aleatoriedad con semilla es una herramienta de reproducibilidad educativa, no aleatoriedad segura para despliegues reales.', '');
  for (const r of runs) {
    const reflection = readState<string>(`reflection:${r.experimentId}`, '');
    lines.push(`## ${r.name}`, '');
    lines.push(`- **Experimento:** ${r.experimentTitle}`);
    lines.push(`- **Fecha:** ${new Date(r.createdAt).toLocaleString('es-ES')}`);
    lines.push(`- **Semilla aleatoria:** ${r.seed ?? '—'}`, '');
    lines.push('### Configuración del experimento', '', '| Parámetro | Valor |', '|---|---|');
    for (const [k, v] of Object.entries(r.params)) lines.push(`| ${k} | ${fmtVal(v)} |`);
    if (r.dataConfig && Object.keys(r.dataConfig).length) {
      lines.push('', '### Configuración del conjunto de datos', '', '| Parámetro | Valor |', '|---|---|');
      for (const [k, v] of Object.entries(r.dataConfig)) lines.push(`| ${k} | ${fmtVal(v)} |`);
    }
    lines.push('', '### Resultados', '', '| Métrica | Valor |', '|---|---|');
    for (const [k, v] of Object.entries(r.results)) lines.push(`| ${k} | ${fmtVal(v)} |`);
    lines.push('', '### Supuestos matemáticos', '');
    if (r.assumptions.length) r.assumptions.forEach((a) => lines.push(`- ${a}`));
    else lines.push('- (no se registraron supuestos específicos)');
    lines.push('');
    lines.push(...privacySection(r));
    lines.push('### Limitaciones', '');
    r.limitations.forEach((a) => lines.push(`- ${a}`));
    lines.push('', '**Limitaciones generales del laboratorio:**', '');
    GENERAL_LIMITATIONS.forEach((a) => lines.push(`- ${a}`));
    lines.push('', '### Observaciones del estudiante', '', r.notes || reflection || '_(sin observaciones)_', '');
  }
  return lines.join('\n');
}

export function runsToJson(runs: ExperimentRun[]): string {
  return JSON.stringify({ app: 'privacyml-lab', version: 2, exportedAt: new Date().toISOString(), generalLimitations: GENERAL_LIMITATIONS, runs }, null, 2);
}
