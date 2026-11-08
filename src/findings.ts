import type { Finding } from './types.ts';

export interface VerifiedFindings {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// Descarta hallazgos que no se pueden comprobar contra el código real:
// archivo inexistente o cita que no aparece (ignorando diferencias de espacios).
export function verifyFindings(findings: Finding[], readFile: (path: string) => string | null): VerifiedFindings {
  const result: VerifiedFindings = { kept: [], dropped: [] };
  for (const finding of findings) {
    const content = readFile(normPath(finding.file));
    if (content === null) {
      result.dropped.push({ finding, reason: `El archivo ${finding.file} no existe en el worktree.` });
    } else if (!squash(content).includes(squash(finding.quote))) {
      result.dropped.push({ finding, reason: `La cita no aparece en ${finding.file}.` });
    } else {
      result.kept.push(finding);
    }
  }
  return result;
}
