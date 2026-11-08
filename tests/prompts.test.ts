import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fillTemplate, renderPrompt, PROMPT_DIR, type Role } from '../src/prompts.ts';

describe('prompts', () => {
  it('sustituye variables', () => {
    expect(fillTemplate('a {{x}} b {{x}}', { x: '1' })).toBe('a 1 b 1');
  });
  it('falla si falta una variable', () => {
    expect(() => fillTemplate('{{nope}}', {})).toThrow(/nope/);
  });
  it('cada prompt se puede renderizar con sus variables', () => {
    const roles: Role[] = ['spec-writer', 'builder', 'reviewer-code', 'reviewer-security', 'approver', 'risk-classifier'];
    for (const role of roles) {
      const vars = Object.fromEntries(
        [...readFileSync(join(PROMPT_DIR, `${role}.md`), 'utf8').matchAll(/\{\{(\w+)\}\}/g)].map((m) => [m[1], `<${m[1]}>`]),
      );
      expect(renderPrompt(role, vars)).not.toMatch(/\{\{/);
    }
  });
});
