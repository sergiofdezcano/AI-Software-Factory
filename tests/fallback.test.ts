import { describe, it, expect } from 'vitest';
import { FallbackRunner } from '../src/runners/fallback.ts';
import { AgentError, QuotaError, type AgentRunner } from '../src/runners/types.ts';

const call = { prompt: 'p', cwd: '.', schema: 'risk' as const, mode: 'read' as const, timeoutMs: 1 };
const ok = (name: string): AgentRunner => ({ name, run: async () => ({ raw: name, data: { from: name } }) });
const quota: AgentRunner = { name: 'codex', run: async () => { throw new QuotaError('usage limit'); } };
const broken: AgentRunner = { name: 'codex', run: async () => { throw new AgentError('boom'); } };

describe('FallbackRunner', () => {
  it('usa el principal si funciona', async () => {
    expect((await new FallbackRunner(ok('a'), ok('b')).run(call)).data).toEqual({ from: 'a' });
  });
  it('si el principal no tiene cuota, usa el de reserva y lo avisa', async () => {
    const notes: string[] = [];
    const r = new FallbackRunner(quota, ok('claude'), (n) => notes.push(n));
    expect((await r.run(call)).data).toEqual({ from: 'claude' });
    expect(notes[0]).toMatch(/codex.*claude/);
  });
  it('otros errores no se esconden', async () => {
    await expect(new FallbackRunner(broken, ok('b')).run(call)).rejects.toBeInstanceOf(AgentError);
  });
});
