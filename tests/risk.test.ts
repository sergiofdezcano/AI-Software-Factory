import { describe, it, expect } from 'vitest';
import { rulesRisk, combineRisk, automergeBlockers } from '../src/risk.ts';
import type { CheckResult, Finding } from '../src/types.ts';

const low = ['src/data/*.json', 'src/styles/**'];

describe('rulesRisk', () => {
  it('bajo si todo está en rutas de bajo riesgo', () => {
    expect(rulesRisk(['src/data/setup.json', 'src/styles/global.css'], low).level).toBe('low');
  });
  it('alto si algo queda fuera, y nombra el archivo', () => {
    const r = rulesRisk(['src/data/setup.json', 'src/components/Tweets.astro'], low);
    expect(r.level).toBe('high');
    expect(r.reason).toContain('src/components/Tweets.astro');
  });
  it('alto si no hay archivos', () => {
    expect(rulesRisk([], low).level).toBe('high');
  });
  it('no deja que * cruce directorios', () => {
    expect(rulesRisk(['src/data/sub/x.json'], low).level).toBe('high');
  });
  it('normaliza barras invertidas', () => {
    expect(rulesRisk(['src\\data\\setup.json'], low).level).toBe('low');
  });
  it('alto si brain/ cambia pero no está en la lista', () => {
    expect(rulesRisk(['src/data/setup.json', 'brain/decisions/0002-x.md'], low).level).toBe('high');
  });
});

describe('combineRisk', () => {
  it('el clasificador solo puede subir', () => {
    expect(combineRisk({ level: 'low', reason: 'r' }, { level: 'high', reason: 'c' })).toEqual({ level: 'high', reason: 'c', source: 'classifier' });
    expect(combineRisk({ level: 'low', reason: 'r' }, { level: 'low', reason: 'c' })).toEqual({ level: 'low', reason: 'c', source: 'classifier' });
  });
  it('si las reglas dicen alto, el clasificador se ignora', () => {
    expect(combineRisk({ level: 'high', reason: 'r' }, { level: 'low', reason: 'c' })).toEqual({ level: 'high', reason: 'r', source: 'rules' });
    expect(combineRisk({ level: 'high', reason: 'r' }, undefined).level).toBe('high');
  });
  it('sin clasificador y reglas en bajo, se queda en alto por precaución', () => {
    expect(combineRisk({ level: 'low', reason: 'r' }, undefined).level).toBe('high');
  });
});

describe('automergeBlockers', () => {
  const passed: CheckResult[] = [{ name: 'check', status: 'passed', output: '' }];
  const minor: Finding = { file: 'a', line: 1, severity: 'minor', description: 'd', quote: 'q' };
  const base = { risk: 'low' as const, checks: passed, decision: 'approve' as const, findings: [minor] };

  it('sin bloqueos en el caso bueno', () => {
    expect(automergeBlockers(base)).toEqual([]);
  });
  it('bloquea por riesgo, checks, veredicto y hallazgos', () => {
    expect(automergeBlockers({ ...base, risk: 'high' })).toHaveLength(1);
    expect(automergeBlockers({ ...base, checks: [{ name: 'check', status: 'not_run', output: '' }] })).toHaveLength(1);
    expect(automergeBlockers({ ...base, checks: [] })).toHaveLength(1);
    expect(automergeBlockers({ ...base, decision: 'changes' })).toHaveLength(1);
    expect(automergeBlockers({ ...base, findings: [{ ...minor, severity: 'major' }] })).toHaveLength(1);
  });
});
