import type { BuildReport, CheckResult, Finding, RunState, Spec } from './types.ts';

const list = (items: string[], empty = '_Ninguno._') => (items.length ? items.map((i) => `- ${i}`).join('\n') : empty);

export const MARKER = '<!-- ai-software-factory -->';

export function specToMarkdown(spec: Spec, revision: number): string {
  const stories = spec.stories
    .map(
      (s, i) =>
        `${i + 1}. **${s.action}**\n   - Condiciones: ${s.conditions || '—'}\n   - Permisos: ${s.permissions || '—'}\n   - Resultado: ${s.expected_result}`,
    )
    .join('\n');
  const acceptance = spec.acceptance
    .map((a) => `| ${a.id} | ${a.criterion} | ${a.proof} | ${a.evidence} |`)
    .join('\n');
  const questions = spec.open_questions.length
    ? `\n### ⚠️ Necesito que decidas\n${list(spec.open_questions)}\n\nResponde en tu \`/revise\`.\n`
    : '';
  return `${MARKER}
## Spec propuesta (versión ${revision}): ${spec.title}

${spec.summary}

### Qué podrá hacer el usuario
${stories}

### Criterios de aceptación
| ID | Criterio | Prueba | Evidencia |
|---|---|---|---|
${acceptance}

### Debe respetar
${list(spec.must_respect.map((m) => `\`${m.path}\`: ${m.reason}`))}

### Fuera de alcance
${list(spec.out_of_scope)}

### Cambios en el brain
${list(spec.brain_updates.map((b) => `\`${b.path}\`: ${b.change}`))}
${questions}
---
Responde con \`/approve\` para construirla o \`/revise <qué cambiar>\` para otra versión.`;
}

export interface PrBodyInput {
  issue: number;
  spec: Spec;
  report: BuildReport;
  checks: CheckResult[];
  findings: Finding[];
  dropped: number;
  risk: NonNullable<RunState['risk']>;
  blockers: string[];
}

export function prBody(i: PrBodyInput): string {
  const criteria = i.report.criteria.map((c) => `| ${c.id} | ${c.status} | ${c.evidence} |`).join('\n');
  const checks = i.checks.map((c) => `| ${c.name} | ${c.status} |`).join('\n');
  const findings = i.findings.length
    ? i.findings.map((f) => `- **${f.severity}** \`${f.file}:${f.line}\`: ${f.description}`).join('\n')
    : '_Sin hallazgos._';
  const dropped = i.dropped ? `\n\n_${i.dropped} hallazgo(s) descartado(s) porque su cita no aparece en el código._` : '';
  return `${MARKER}
Closes #${i.issue}

## ${i.spec.title}
${i.spec.summary}

### Qué se hizo
${i.report.summary}

### Evidencia por criterio
| ID | Estado | Evidencia |
|---|---|---|
${criteria}

### Controles (ejecutados por la fábrica)
| Control | Estado |
|---|---|
${checks}

### Hallazgos verificados de los revisores
${findings}${dropped}

### Riesgo: ${i.risk.level} (${i.risk.source})
${i.risk.reason}

### Por qué no se mergeó solo
${list(i.blockers, '_Se mergeó automáticamente._')}`;
}
