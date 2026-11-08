import { execa } from 'execa';
import type { SchemaName } from '../schema.ts';

export interface AgentCall {
  prompt: string;
  cwd: string;
  schema: SchemaName;
  mode: 'read' | 'write';
  timeoutMs: number;
}

export interface AgentOutput {
  raw: string;
  data: unknown;
}

export interface AgentRunner {
  readonly name: string;
  run(call: AgentCall): Promise<AgentOutput>;
}

// Límite de uso de la suscripción: la tarea se pausa y se reintenta más tarde.
export class QuotaError extends Error {
  name = 'QuotaError';
}

// Cualquier otro fallo del agente (timeout, salida ilegible, error del CLI).
export class AgentError extends Error {
  name = 'AgentError';
}

export const QUOTA_PATTERN = /usage limit|rate limit|limit reached|quota|too many requests|\b429\b/i;

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export type Exec = (cmd: string, args: string[], opts: { cwd: string; input?: string; timeoutMs?: number }) => Promise<ExecResult>;

export const realExec: Exec = async (cmd, args, opts) => {
  const r = await execa(cmd, args, {
    cwd: opts.cwd,
    input: opts.input ?? '',
    timeout: opts.timeoutMs,
    reject: false,
    windowsHide: true,
    maxBuffer: 200 * 1024 * 1024,
  });
  return {
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
    exitCode: r.exitCode ?? 1,
    timedOut: Boolean(r.timedOut),
  };
};

// Extrae JSON de un texto que puede venir envuelto en ```json ... ```.
export function parseJsonLoose(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new AgentError(`La respuesta no es JSON: ${candidate.slice(0, 300)}`);
  }
}
