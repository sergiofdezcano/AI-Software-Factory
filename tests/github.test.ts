import { describe, it, expect } from 'vitest';
import { DryRunGitHub, GhCli, type GitHub } from '../src/github.ts';
import type { Exec } from '../src/runners/types.ts';

describe('DryRunGitHub', () => {
  it('lee del real y solo registra escrituras', async () => {
    let writes = 0;
    const inner: GitHub = {
      getIssue: async () => ({ title: 't', body: 'b', labels: [], comments: [] }),
      comment: async () => void writes++,
      setStatus: async () => void writes++,
      createPR: async () => (writes++, 'u'),
      mergePR: async () => void writes++,
    };
    const dry = new DryRunGitHub(inner, () => {});
    expect((await dry.getIssue('o/r', 1)).title).toBe('t');
    await dry.comment('o/r', 1, 'hola');
    await dry.setStatus('o/r', 1, 'factory:spec');
    expect(await dry.createPR('o/r', { head: 'h', base: 'main', title: 't', body: 'b' })).toContain('DRY-RUN');
    await dry.mergePR('o/r', 'u');
    expect(writes).toBe(0);
    expect(dry.writes).toHaveLength(4);
  });
});

describe('GhCli', () => {
  it('mapea issue y comentarios', async () => {
    const exec: Exec = async () => ({
      stdout: JSON.stringify({
        title: 'T',
        body: null,
        labels: [{ name: 'factory' }],
        comments: [{ author: { login: 'sergio' }, body: '/approve', createdAt: '2026-11-08T10:00:00Z' }],
      }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const issue = await new GhCli(exec).getIssue('o/r', 3);
    expect(issue).toEqual({
      title: 'T',
      body: '',
      labels: ['factory'],
      comments: [{ author: 'sergio', body: '/approve', createdAt: '2026-11-08T10:00:00Z' }],
    });
  });

  it('al cambiar de estado quita las otras etiquetas factory:*', async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      const stdout = args[1] === 'view' ? JSON.stringify({ title: '', body: '', labels: [{ name: 'factory' }, { name: 'factory:spec' }], comments: [] }) : '';
      return { stdout, stderr: '', exitCode: 0, timedOut: false };
    };
    await new GhCli(exec).setStatus('o/r', 3, 'factory:awaiting-spec');
    const edit = calls.find((a) => a[1] === 'edit')!;
    expect(edit[edit.indexOf('--add-label') + 1]).toBe('factory:awaiting-spec');
    expect(edit[edit.indexOf('--remove-label') + 1]).toBe('factory:spec');
  });
});
