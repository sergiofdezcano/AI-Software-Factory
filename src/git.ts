import { existsSync, rmSync } from 'node:fs';
import { realExec, type Exec } from './runners/types.ts';

export interface Git {
  createWorktree(repoPath: string, worktree: string, branch: string, base: string): Promise<void>;
  changedFiles(worktree: string, base: string): Promise<string[]>;
  diff(worktree: string, base: string): Promise<string>;
  trackedFiles(worktree: string): Promise<string[]>;
  commitAll(worktree: string, message: string): Promise<boolean>;
  push(worktree: string, branch: string): Promise<void>;
  removeWorktree(repoPath: string, worktree: string): Promise<void>;
  // Trae lo último de la rama base y lo mezcla. Si hay conflictos, deja el merge a medias
  // (con marcadores) para que el builder los resuelva, y devuelve los archivos afectados.
  syncWithBase(worktree: string, base: string): Promise<{ conflicts: string[] }>;
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

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

  async syncWithBase(worktree: string, base: string) {
    // Conflictos pendientes de una vuelta anterior, o marcadores que se colaron en un commit.
    const unmerged = lines(await this.git(worktree, ['diff', '--name-only', '--diff-filter=U']));
    if (unmerged.length) return { conflicts: unmerged };
    const markers = await this.exec('git', ['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>) '], { cwd: worktree, timeoutMs: 60_000 });
    if (markers.exitCode === 0 && markers.stdout.trim()) return { conflicts: lines(markers.stdout) };

    await this.git(worktree, ['fetch', 'origin', base]);
    const merge = await this.exec('git', ['merge', '--no-edit', `origin/${base}`], { cwd: worktree, timeoutMs: 300_000 });
    if (merge.exitCode === 0) return { conflicts: [] };
    const conflicts = lines(await this.git(worktree, ['diff', '--name-only', '--diff-filter=U']));
    if (!conflicts.length) throw new Error(`git merge origin/${base} falló: ${merge.stderr.trim()}`);
    return { conflicts };
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

  // En Windows algún proceso (antivirus, indexador, un preview que se cierra) puede
  // bloquear archivos unos segundos. Se reintenta y, al final, se borra a mano y se poda.
  async removeWorktree(repoPath: string, worktree: string) {
    for (let attempt = 1; attempt <= 3 && existsSync(worktree); attempt++) {
      try {
        await this.git(repoPath, ['worktree', 'remove', '--force', worktree]);
      } catch {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
    await this.git(repoPath, ['worktree', 'prune']);
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
  syncWithBase(w: string, b: string) {
    return this.inner.syncWithBase(w, b);
  }
  async push(_w: string, branch: string) {
    this.log(`[dry-run] push de ${branch}`);
  }
  removeWorktree(r: string, w: string) {
    return this.inner.removeWorktree(r, w);
  }
}
