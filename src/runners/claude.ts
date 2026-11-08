import { loadSchema } from '../schema.ts';
import { AgentError, QUOTA_PATTERN, QuotaError, parseJsonLoose, realExec, type AgentCall, type AgentOutput, type AgentRunner, type Exec } from './types.ts';

// Los permisos se imponen con flags del CLI, no con el prompt.
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)'];
const WRITE_TOOLS = [
  ...READ_TOOLS,
  'Edit',
  'Write',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(node:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git rm:*)',
  'Bash(git mv:*)',
  'Bash(ls:*)',
];
const ALWAYS_DENIED = ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(git remote:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git reset:*)', 'WebFetch', 'WebSearch'];
const READ_DENIED = ['Edit', 'Write', 'NotebookEdit', ...ALWAYS_DENIED];

export interface ClaudeRunnerOptions {
  model: string;
  maxTurns?: number;
  exec?: Exec;
  bin?: string;
}

export class ClaudeRunner implements AgentRunner {
  readonly name: string;
  private exec: Exec;

  constructor(private opts: ClaudeRunnerOptions) {
    this.name = `claude:${opts.model}`;
    this.exec = opts.exec ?? realExec;
  }

  async run(call: AgentCall): Promise<AgentOutput> {
    const write = call.mode === 'write';
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      this.opts.model,
      '--json-schema',
      JSON.stringify(loadSchema(call.schema)),
      '--allowedTools',
      (write ? WRITE_TOOLS : READ_TOOLS).join(' '),
      '--disallowedTools',
      (write ? ALWAYS_DENIED : READ_DENIED).join(' '),
      '--permission-mode',
      write ? 'acceptEdits' : 'default',
      '--max-turns',
      String(this.opts.maxTurns ?? (write ? 200 : 60)),
      '--no-session-persistence',
    ];
    const r = await this.exec(this.opts.bin ?? 'claude', args, { cwd: call.cwd, input: call.prompt, timeoutMs: call.timeoutMs });
    const raw = r.stdout;
    if (r.timedOut) throw new AgentError(`${this.name} superó el tiempo máximo (${call.timeoutMs} ms)`);

    let parsed: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string } | undefined;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const errorText = `${parsed?.result ?? ''}\n${r.stderr}`;
    if (r.exitCode !== 0 || !parsed || parsed.is_error) {
      if (QUOTA_PATTERN.test(errorText)) throw new QuotaError(`${this.name}: ${errorText.trim().slice(0, 300)}`);
      throw new AgentError(`${this.name} falló (código ${r.exitCode}, ${parsed?.subtype ?? 'sin JSON'}): ${errorText.trim().slice(0, 500)}`);
    }
    const data = parsed.structured_output ?? parseJsonLoose(parsed.result ?? '');
    return { raw, data };
  }
}
