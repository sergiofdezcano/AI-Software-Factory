import { describe, it, expect } from 'vitest';
import { validate, SchemaError } from '../src/schema.ts';
import { validSpec } from './fixtures.ts';

describe('validate', () => {
  it('acepta una spec válida', () => {
    expect(validate('spec', validSpec)).toEqual(validSpec);
  });

  it('rechaza una spec sin acceptance nombrando el campo', () => {
    const { acceptance, ...rest } = validSpec;
    expect(() => validate('spec', rest)).toThrow(SchemaError);
    expect(() => validate('spec', rest)).toThrow(/acceptance/);
  });

  it('rechaza un hallazgo con severidad desconocida', () => {
    const bad = { findings: [{ file: 'a', line: 1, severity: 'huge', description: 'x', quote: 'y' }] };
    expect(() => validate('findings', bad)).toThrow(SchemaError);
  });

  it('valida veredictos', () => {
    expect(validate('verdict', { decision: 'changes', changes: ['x'], reason: 'r' })).toBeTruthy();
    expect(() => validate('verdict', { decision: 'maybe', changes: [], reason: 'r' })).toThrow();
  });
});
