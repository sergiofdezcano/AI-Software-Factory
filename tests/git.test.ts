import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitCli } from '../src/git.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

// origin (bare) <- clon "main" para empujar cambios; la fábrica trabaja en un worktree aparte.
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'factory-git-'));
  const origin = join(root, 'origin.git');
  const main = join(root, 'main');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, main);
  git(main, 'config', 'user.name', 't');
  git(main, 'config', 'user.email', 't@t');
  writeFileSync(join(main, 'a.txt'), 'uno\n');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'inicio');
  git(main, 'push', '-q', 'origin', 'main');
  const wt = join(root, 'wt');
  return { root, main, wt };
}

describe('GitCli.syncWithBase', () => {
  it('mezcla main sin conflictos', async () => {
    const { main, wt } = setup();
    const cli = new GitCli();
    await cli.createWorktree(main, wt, 'factory/1-x', 'main');
    writeFileSync(join(wt, 'b.txt'), 'nuevo\n');
    git(wt, 'add', '.');
    git(wt, 'commit', '-qm', 'tarea');
    writeFileSync(join(main, 'c.txt'), 'otro\n');
    git(main, 'add', '.');
    git(main, 'commit', '-qm', 'otra tarea');
    git(main, 'push', '-q', 'origin', 'main');
    expect(await cli.syncWithBase(wt, 'main')).toEqual({ conflicts: [] });
    expect(readFileSync(join(wt, 'c.txt'), 'utf8').trim()).toBe('otro');
  });

  it('deja el merge a medias y devuelve los archivos en conflicto, también en la siguiente llamada', async () => {
    const { main, wt } = setup();
    const cli = new GitCli();
    await cli.createWorktree(main, wt, 'factory/2-x', 'main');
    writeFileSync(join(wt, 'a.txt'), 'de la tarea\n');
    git(wt, 'commit', '-qam', 'tarea');
    writeFileSync(join(main, 'a.txt'), 'de main\n');
    git(main, 'commit', '-qam', 'main cambia');
    git(main, 'push', '-q', 'origin', 'main');
    expect(await cli.syncWithBase(wt, 'main')).toEqual({ conflicts: ['a.txt'] });
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toContain('<<<<<<<');
    expect(await cli.syncWithBase(wt, 'main')).toEqual({ conflicts: ['a.txt'] });
    // El builder resuelve y cierra el merge.
    writeFileSync(join(wt, 'a.txt'), 'de main y de la tarea\n');
    git(wt, 'add', '.');
    git(wt, 'commit', '-qm', 'resuelve');
    expect(await cli.syncWithBase(wt, 'main')).toEqual({ conflicts: [] });
  });
});
