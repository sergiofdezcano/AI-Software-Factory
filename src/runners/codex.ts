import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchema } from '../schema.ts';
import { AgentError, QUOTA_PATTERN, QuotaError, parseJsonLoose, realExec, type AgentCall, type AgentOutput, type AgentRunner, type Exec } from './types.ts';

export interface CodexRunnerOptions {
  model?: string; // si se omite, el de ~/.codex/config.toml
  exec?: Exec;
  bin?: string;
}

// Revisor de otra familia de modelos. Siempre en sandbox de solo lectura.
export class CodexRunner implements AgentRunner {
  readonly name: string;
  private exec: Exec;

  constructor(private opts: CodexRunnerOptions = {}) {
    this.name = `codex:${opts.model ?? 'default'}`;
    this.exec = opts.exec ?? realExec;
  }

  async run(call: AgentCall): Promise<AgentOutput> {
    if (call.mode !== 'read') throw new AgentError('CodexRunner solo se usa en modo solo lectura');
    const dir = mkdtempSync(join(tmpdir(), 'factory-codex-'));
    try {
      const schemaFile = join(dir, 'schema.json');
      const outFile = join(dir, 'out.json');
      writeFileSync(schemaFile, JSON.stringify(loadSchema(call.schema)));
      const args = ['exec', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-C', call.cwd, '--output-schema', schemaFile, '-o', outFile];
      if (this.opts.model) args.push('-m', this.opts.model);
      args.push('-');
      const r = await this.exec(this.opts.bin ?? 'codex', args, { cwd: call.cwd, input: call.prompt, timeoutMs: call.timeoutMs });
      if (r.timedOut) throw new AgentError(`${this.name} superó el tiempo máximo (${call.timeoutMs} ms)`);
      const text = `${r.stdout}\n${r.stderr}`;
      if (r.exitCode !== 0) {
        if (QUOTA_PATTERN.test(text)) throw new QuotaError(`${this.name}: ${text.trim().slice(-300)}`);
        throw new AgentError(`${this.name} falló (código ${r.exitCode}): ${text.trim().slice(-500)}`);
      }
      if (!existsSync(outFile)) throw new AgentError(`${this.name} no escribió respuesta final`);
      const raw = readFileSync(outFile, 'utf8');
      return { raw, data: parseJsonLoose(raw) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
