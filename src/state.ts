import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from './types.ts';

export function initialState(): RunState {
  return { step: 'spec', specRevisions: 0, buildRounds: 0, paused: false };
}

// Estado y evidencia de una ejecución en runs/<app>-<issue>/.
export class RunStore {
  constructor(readonly dir: string) {}

  private get stateFile() {
    return join(this.dir, 'state.json');
  }

  load(): RunState {
    if (!existsSync(this.stateFile)) return initialState();
    return JSON.parse(readFileSync(this.stateFile, 'utf8')) as RunState;
  }

  save(state: RunState): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  // Guarda un artefacto de auditoría con prefijo numérico creciente.
  artifact(name: string, content: unknown): string {
    mkdirSync(this.dir, { recursive: true });
    const last = readdirSync(this.dir)
      .map((f) => Number.parseInt(f.slice(0, 3), 10))
      .filter((n) => !Number.isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    const file = join(this.dir, `${String(last + 1).padStart(3, '0')}-${name}`);
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return file;
  }
}
