import { execa } from 'execa';
import type { CheckResult } from './types.ts';

export interface Checks {
  run(name: string, command: string, cwd: string, timeoutMs: number): Promise<CheckResult>;
}

const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);

// Ejecuta los controles declarados en .factory.yml. Lo hace la fábrica, no el agente.
// `env` llega a los comandos; p. ej. FACTORY_EVIDENCE_DIR para guardar capturas en runs/.
export class ShellChecks implements Checks {
  constructor(private env: Record<string, string> = {}) {}

  async run(name: string, command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
    const r = await execa(command, { cwd, shell: true, reject: false, timeout: timeoutMs, all: true, windowsHide: true, env: this.env });
    const output = tail(String(r.all ?? ''));
    if (r.timedOut) return { name, status: 'failed', output: `Tiempo agotado (${timeoutMs} ms)\n${output}` };
    return { name, status: r.exitCode === 0 ? 'passed' : 'failed', output };
  }
}
