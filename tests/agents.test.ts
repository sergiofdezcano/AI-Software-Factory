import { describe, it, expect } from 'vitest';
import { makeAgents } from '../src/agents.ts';

describe('makeAgents', () => {
  it('cada rol tiene reserva de la otra familia de modelos', () => {
    const a = makeAgents({});
    expect(a.specWriter.name).toBe('claude:opus|codex:default');
    expect(a.builder.name).toBe('claude:opus|codex:default');
    expect(a.reviewerCode.name).toBe('claude:sonnet|codex:default');
    expect(a.reviewerSecurity.name).toBe('codex:default|claude:sonnet');
    expect(a.approver.name).toBe('claude:opus|codex:default');
    expect(a.riskClassifier.name).toBe('claude:opus|codex:default');
  });

  it('respeta los modelos configurados por entorno', () => {
    const a = makeAgents({ env: { FACTORY_MODEL_BIG: 'fable', FACTORY_MODEL_REVIEW: 'haiku', FACTORY_MODEL_CODEX: 'gpt-x' } });
    expect(a.builder.name).toBe('claude:fable|codex:gpt-x');
    expect(a.reviewerSecurity.name).toBe('codex:gpt-x|claude:haiku');
  });
});
