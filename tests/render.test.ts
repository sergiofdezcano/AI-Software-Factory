import { describe, it, expect } from 'vitest';
import { specToMarkdown, prBody } from '../src/render.ts';
import { validSpec } from './fixtures.ts';

describe('specToMarkdown', () => {
  it('incluye historias, criterios, restricciones e instrucciones', () => {
    const md = specToMarkdown({ ...validSpec, open_questions: ['¿Qué marca?'] }, 1);
    expect(md).toContain('Añadir micrófono al setup');
    expect(md).toContain('Ver el micrófono en la sección Setup');
    expect(md).toContain('A1');
    expect(md).toContain('brain/decisions/0001-datos-en-json.md');
    expect(md).toContain('¿Qué marca?');
    expect(md).toContain('/approve');
    expect(md).toContain('/revise');
  });
});

describe('prBody', () => {
  it('incluye evidencia, controles, hallazgos y riesgo', () => {
    const body = prBody({
      issue: 12,
      spec: validSpec,
      report: { summary: 'Hecho', criteria: [{ id: 'A1', status: 'done', evidence: 'test verde' }], notes: '' },
      checks: [{ name: 'check', status: 'passed', output: 'ok' }],
      findings: [{ file: 'src/a.ts', line: 3, severity: 'minor', description: 'nombre poco claro', quote: 'x' }],
      dropped: 1,
      risk: { level: 'high', reason: 'Archivos fuera de low_risk_paths: src/x.astro', source: 'rules' },
      blockers: ['Riesgo alto.'],
    });
    expect(body).toContain('Closes #12');
    expect(body).toContain('test verde');
    expect(body).toContain('passed');
    expect(body).toContain('nombre poco claro');
    expect(body).toContain('src/x.astro');
    expect(body).toContain('Riesgo alto.');
    expect(body).toContain('1 hallazgo');
  });
});
