import { existsSync } from 'node:fs';
import { realExec, type Exec } from './runners/types.ts';

export interface Git {
  createWorktree(repoPath: string, worktree: string, branch: string, base: string): Promise<void>;
  changedFiles(worktree: string, base: string): Promise<string[]>;
  diff(worktree: string, base: string): Promise<string>;
  trackedFiles(worktree: string): Promise<string[]>;
  commitAll(worktree: string, message: string): Promise<boolean>;
  push(worktree: string, branch: string): Promise<void>;
  removeWorktree(repoPath: string, worktree: string): Promise<void>;
}

export class GitCli implements Git {
  constructor(private exec: Exec = realExec) {}

  private async git(cwd: string, args: string[]): Promise<string> {
    const r = await this.exec('git', args, { cwd, timeoutMs: 300_000 });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} falló: ${r.stderr.trim()}`);
    return r.stdout;
  }

  async createWorktree(repoPath: string, worktree: string, branch: string, base: string) {
    if (existsSync(worktree)) return; // reanudación
    await this.git(repoPath, ['fetch', 'origin', base]);
    await this.git(repoPath, ['worktree', 'add', '-B', branch, worktree, `origin/${base}`]);
  }

  async changedFiles(worktree: string, base: string) {
    const out = await this.git(worktree, ['diff', '--name-only', `origin/${base}...HEAD`]);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async diff(worktree: string, base: string) {
    return this.git(worktree, ['diff', `origin/${base}...HEAD`]);
  }

  async trackedFiles(worktree: string) {
    return (await this.git(worktree, ['ls-files'])).split('\n').filter(Boolean);
  }

  async commitAll(worktree: string, message: string) {
    await this.git(worktree, ['add', '-A']);
    const status = await this.git(worktree, ['status', '--porcelain']);
    if (!status.trim()) return false;
    await this.git(worktree, ['commit', '-m', message]);
    return true;
  }

  async push(worktree: string, branch: string) {
    await this.git(worktree, ['push', '-u', 'origin', branch, '--force-with-lease']);
  }

  async removeWorktree(repoPath: string, worktree: string) {
    if (!existsSync(worktree)) return;
    await this.git(repoPath, ['worktree', 'remove', '--force', worktree]);
  }
}

// En dry-run no se empuja nada; el resto de git es local y se ejecuta.
export class DryRunGit implements Git {
  constructor(private inner: Git, private log: (msg: string) => void = console.log) {}
  createWorktree(r: string, w: string, b: string, base: string) {
    return this.inner.createWorktree(r, w, b, base);
  }
  changedFiles(w: string, b: string) {
    return this.inner.changedFiles(w, b);
  }
  diff(w: string, b: string) {
    return this.inner.diff(w, b);
  }
  trackedFiles(w: string) {
    return this.inner.trackedFiles(w);
  }
  commitAll(w: string, m: string) {
    return this.inner.commitAll(w, m);
  }
  async push(_w: string, branch: string) {
    this.log(`[dry-run] push de ${branch}`);
  }
  removeWorktree(r: string, w: string) {
    return this.inner.removeWorktree(r, w);
  }
}
