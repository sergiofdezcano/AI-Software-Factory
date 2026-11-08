import { describe, it, expect } from 'vitest';
import { parseApproval } from '../src/commands.ts';

const since = '2026-11-08T10:00:00Z';
const c = (author: string, body: string, createdAt = '2026-11-08T11:00:00Z') => ({ author, body, createdAt });

describe('parseApproval', () => {
  it('sin comentarios no hay decisión', () => {
    expect(parseApproval([], since, 'sergio')).toBeNull();
  });
  it('detecta /approve', () => {
    expect(parseApproval([c('sergio', '/approve')], since, 'sergio')).toEqual({ kind: 'approve' });
  });
  it('detecta /revise con texto multilínea', () => {
    expect(parseApproval([c('sergio', '/revise usa otro color\ny más grande')], since, 'sergio')).toEqual({
      kind: 'revise',
      text: 'usa otro color\ny más grande',
    });
  });
  it('ignora otros autores', () => {
    expect(parseApproval([c('intruso', '/approve')], since, 'sergio')).toBeNull();
  });
  it('ignora comentarios anteriores a la spec', () => {
    expect(parseApproval([c('sergio', '/approve', '2026-11-08T09:00:00Z')], since, 'sergio')).toBeNull();
  });
  it('gana el último comando', () => {
    const r = parseApproval(
      [c('sergio', '/revise x', '2026-11-08T11:00:00Z'), c('sergio', '/approve', '2026-11-08T12:00:00Z')],
      since,
      'sergio',
    );
    expect(r).toEqual({ kind: 'approve' });
  });
  it('ignora texto normal y /revise vacío', () => {
    expect(parseApproval([c('sergio', 'me gusta, /approve luego'), c('sergio', '/revise')], since, 'sergio')).toBeNull();
  });
  it('compara el login sin distinguir mayúsculas', () => {
    expect(parseApproval([c('Sergio', '/approve')], since, 'sergio')).toEqual({ kind: 'approve' });
  });
});
