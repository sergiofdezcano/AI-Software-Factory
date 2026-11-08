import picomatch from 'picomatch';
import type { CheckResult, Finding, RiskAssessment, RiskLevel, Verdict } from './types.ts';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// Primera barrera, en código: cualquier archivo fuera de las rutas de bajo riesgo => alto.
export function rulesRisk(changedFiles: string[], lowRiskPaths: string[]): RiskAssessment {
  if (changedFiles.length === 0) return { level: 'high', reason: 'El diff no tiene archivos; no se puede clasificar.' };
  const isLow = picomatch(lowRiskPaths.length ? lowRiskPaths : ['\u0000never']);
  const outside = changedFiles.map(norm).filter((f) => !isLow(f));
  if (outside.length) {
    return { level: 'high', reason: `Archivos fuera de low_risk_paths: ${outside.join(', ')}` };
  }
  return { level: 'low', reason: 'Todos los archivos están en low_risk_paths.' };
}

// El clasificador solo puede subir el riesgo. Si las reglas dicen alto, ni se consulta.
// Si dicen bajo pero no hay opinión del clasificador, se queda en alto por precaución.
export function combineRisk(
  rules: RiskAssessment,
  classifier: RiskAssessment | undefined,
): RiskAssessment & { source: 'rules' | 'classifier' } {
  if (rules.level === 'high') return { ...rules, source: 'rules' };
  if (!classifier) return { level: 'high', reason: 'Falta la opinión del clasificador.', source: 'rules' };
  return { level: classifier.level, reason: classifier.reason, source: 'classifier' };
}

export interface AutomergeInput {
  risk: RiskLevel;
  checks: CheckResult[];
  decision: Verdict['decision'];
  findings: Finding[];
}

// Lista de motivos que impiden el automerge. Vacía => se puede mergear solo.
export function automergeBlockers(i: AutomergeInput): string[] {
  const out: string[] = [];
  if (i.risk !== 'low') out.push('Riesgo alto.');
  if (i.checks.length === 0 || i.checks.some((c) => c.status !== 'passed')) {
    out.push('Hay controles sin pasar o sin ejecutar.');
  }
  if (i.decision !== 'approve') out.push('El approver no aprobó.');
  if (i.findings.some((f) => f.severity !== 'minor')) out.push('Hay hallazgos blocker o major verificados.');
  return out;
}
