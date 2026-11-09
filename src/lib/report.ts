import type { ExperimentRun } from './runs';
import { readState } from './store';

function fmtVal(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('es-ES', { maximumFractionDigits: 4 });
  if (v === null || v === undefined) return '—';
  return String(v);
}

/** Informe educativo conciso en Markdown (exportación 100 % en el cliente). */
export function buildReport(runs: ExperimentRun[]): string {
  const lines: string[] = [];
  lines.push('# Informe — Privacy-Preserving ML Lab', '');
  lines.push(`Generado: ${new Date().toLocaleString('es-ES')}`, '');
  lines.push('> Todos los datos son sintéticos. La aleatoriedad con semilla es una herramienta de reproducibilidad, no aleatoriedad segura para despliegues reales.', '');
  for (const r of runs) {
    const reflection = readState<string>(`reflection:${r.experimentId}`, '');
    lines.push(`## ${r.name}`, '');
    lines.push(`- **Experimento:** ${r.experimentTitle}`);
    lines.push(`- **Fecha:** ${new Date(r.createdAt).toLocaleString('es-ES')}`);
    lines.push(`- **Semilla aleatoria:** ${r.seed ?? '—'}`, '');
    lines.push('### Parámetros', '', '| Parámetro | Valor |', '|---|---|');
    for (const [k, v] of Object.entries(r.params)) lines.push(`| ${k} | ${fmtVal(v)} |`);
    lines.push('', '### Resultados', '', '| Métrica | Valor |', '|---|---|');
    for (const [k, v] of Object.entries(r.results)) lines.push(`| ${k} | ${fmtVal(v)} |`);
    lines.push('', '### Supuestos matemáticos', '');
    r.assumptions.forEach((a) => lines.push(`- ${a}`));
    lines.push('', '### Garantía de privacidad', '', r.privacyGuarantee ?? 'No se ha establecido una garantía formal de privacidad para esta ejecución.', '');
    lines.push('### Limitaciones', '');
    r.limitations.forEach((a) => lines.push(`- ${a}`));
    lines.push('', '### Observaciones del estudiante', '', r.notes || reflection || '_(sin observaciones)_', '');
  }
  return lines.join('\n');
}

export function runsToJson(runs: ExperimentRun[]): string {
  return JSON.stringify({ app: 'privacyml-lab', version: 1, exportedAt: new Date().toISOString(), runs }, null, 2);
}
