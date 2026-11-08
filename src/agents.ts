import type { Agents } from './pipeline.ts';
import { ClaudeRunner } from './runners/claude.ts';
import { CodexRunner } from './runners/codex.ts';
import { FallbackRunner } from './runners/fallback.ts';
import type { AgentRunner } from './runners/types.ts';

export interface AgentOptions {
  env?: Record<string, string | undefined>;
  onFallback?: (note: string) => void;
}

// Cada rol tiene un agente principal y uno de reserva de la otra familia de modelos.
// Si se agota la cuota de una suscripción, la tarea sigue con la otra.
// La revisión de seguridad es al revés: Codex primero, para tener otra familia revisando a Claude.
export function makeAgents({ env = process.env, onFallback = () => {} }: AgentOptions): Agents {
  const big = env.FACTORY_MODEL_BIG ?? 'opus';
  const review = env.FACTORY_MODEL_REVIEW ?? 'sonnet';
  const codex = () => new CodexRunner({ model: env.FACTORY_MODEL_CODEX });
  const pair = (primary: AgentRunner, backup: AgentRunner) => new FallbackRunner(primary, backup, onFallback);
  return {
    specWriter: pair(new ClaudeRunner({ model: big }), codex()),
    builder: pair(new ClaudeRunner({ model: big }), codex()),
    reviewerCode: pair(new ClaudeRunner({ model: review }), codex()),
    reviewerSecurity: pair(codex(), new ClaudeRunner({ model: review })),
    approver: pair(new ClaudeRunner({ model: big }), codex()),
    riskClassifier: pair(new ClaudeRunner({ model: big }), codex()),
  };
}
