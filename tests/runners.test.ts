import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { ClaudeRunner } from '../src/runners/claude.ts';
import { CodexRunner } from '../src/runners/codex.ts';
import { QuotaError, AgentError, type Exec, type ExecResult } from '../src/runners/types.ts';

function fakeExec(respond: (cmd: string, args: string[], input?: string) => Partial<ExecResult>) {
  const calls: { cmd: string; args: string[]; input?: string; cwd: string }[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts.input, cwd: opts.cwd });
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false, ...respond(cmd, args, opts.input) };
  };
  return { exec, calls };
}

const call = { prompt: 'hola', cwd: 'C:/wt', schema: 'risk' as const, mode: 'read' as const, timeoutMs: 1000 };

describe('ClaudeRunner', () => {
  it('pasa modelo, esquema y herramientas, y lee structured_output', async () => {
    const { exec, calls } = fakeExec(() => ({
      stdout: JSON.stringify({ is_error: false, subtype: 'success', result: '', structured_output: { level: 'low', reason: 'r' } }),
    }));
    const out = await new ClaudeRunner({ model: 'opus', exec, maxTurns: 40 }).run(call);
    expect(out.data).toEqual({ level: 'low', reason: 'r' });
    const a = calls[0].args;
    expect(calls[0].cmd).toBe('claude');
    expect(calls[0].input).toBe('hola');
    expect(calls[0].cwd).toBe('C:/wt');
    expect(a).toContain('-p');
    expect(a[a.indexOf('--model') + 1]).toBe('opus');
    expect(a[a.indexOf('--max-turns') + 1]).toBe('40');
    expect(JSON.parse(a[a.indexOf('--json-schema') + 1]).required).toEqual(['level', 'reason']);
    expect(a[a.indexOf('--disallowedTools') + 1]).toContain('Edit');
    expect(a).toContain('--strict-mcp-config');
    expect(JSON.parse(a[a.indexOf('--mcp-config') + 1])).toEqual({ mcpServers: {} });
  });

  it('en modo escritura permite editar pero nunca push ni gh', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: JSON.stringify({ is_error: false, structured_output: {} }) }));
    await new ClaudeRunner({ model: 'opus', exec }).run({ ...call, mode: 'write' });
    const a = calls[0].args;
    expect(a[a.indexOf('--allowedTools') + 1]).toContain('Edit');
    expect(a[a.indexOf('--disallowedTools') + 1]).toContain('Bash(git push:*)');
    expect(a[a.indexOf('--disallowedTools') + 1]).toContain('Bash(gh:*)');
  });

  it('si no hay structured_output parsea result', async () => {
    const { exec } = fakeExec(() => ({ stdout: JSON.stringify({ is_error: false, result: '```json\n{"a":1}\n```' }) }));
    expect((await new ClaudeRunner({ model: 'opus', exec }).run(call)).data).toEqual({ a: 1 });
  });

  it('lanza QuotaError ante límite de uso', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 1, stdout: JSON.stringify({ is_error: true, result: "You've hit your usage limit" }) }));
    await expect(new ClaudeRunner({ model: 'opus', exec }).run(call)).rejects.toBeInstanceOf(QuotaError);
  });

  it('lanza AgentError en otros fallos y en timeout', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 1, stderr: 'boom' }));
    await expect(new ClaudeRunner({ model: 'opus', exec }).run(call)).rejects.toBeInstanceOf(AgentError);
    const t = fakeExec(() => ({ timedOut: true, exitCode: 1 }));
    await expect(new ClaudeRunner({ model: 'opus', exec: t.exec }).run(call)).rejects.toThrow(/tiempo/);
  });
});

describe('CodexRunner', () => {
  it('usa sandbox de solo lectura, esquema y archivo de salida', async () => {
    const { exec, calls } = fakeExec((_cmd, args) => {
      const schemaFile = args[args.indexOf('--output-schema') + 1];
      expect(JSON.parse(readFileSync(schemaFile, 'utf8')).required).toEqual(['level', 'reason']);
      writeFileSync(args[args.indexOf('-o') + 1], '{"level":"high","reason":"x"}');
      return {};
    });
    const out = await new CodexRunner({ exec, model: 'gpt-x' }).run(call);
    expect(out.data).toEqual({ level: 'high', reason: 'x' });
    const a = calls[0].args;
    expect(a[0]).toBe('exec');
    expect(a[a.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(a[a.indexOf('-C') + 1]).toBe('C:/wt');
    expect(a[a.indexOf('-m') + 1]).toBe('gpt-x');
    expect(a.at(-1)).toBe('-');
    expect(calls[0].input).toBe('hola');
  });

  it('en modo escritura usa workspace-write (sin red ni push)', async () => {
    const { exec, calls } = fakeExec((_c, args) => {
      writeFileSync(args[args.indexOf('-o') + 1], '{"summary":"s","criteria":[],"notes":""}');
      return {};
    });
    await new CodexRunner({ exec }).run({ ...call, schema: 'build-report', mode: 'write' });
    const a = calls[0].args;
    expect(a[a.indexOf('--sandbox') + 1]).toBe('workspace-write');
  });

  it('detecta límite de uso', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 1, stderr: 'ERROR: You have hit your usage limit. Try again later.' }));
    await expect(new CodexRunner({ exec }).run(call)).rejects.toBeInstanceOf(QuotaError);
  });
});

describe('toOpenAISchema', () => {
  it('quita minLength en profundidad y deja lo demás', async () => {
    const { toOpenAISchema } = await import('../src/runners/codex.ts');
    const out = toOpenAISchema({ type: 'object', properties: { a: { type: 'string', minLength: 1 }, b: { type: 'array', items: { type: 'string', minLength: 2 } } } });
    expect(JSON.stringify(out)).not.toContain('minLength');
    expect(out).toEqual({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'string' } } } });
  });
});
