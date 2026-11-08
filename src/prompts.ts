import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type Role = 'spec-writer' | 'builder' | 'reviewer-code' | 'reviewer-security' | 'approver' | 'risk-classifier';

export const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

// Sustituye {{nombre}} por su valor. Una variable sin valor es un error:
// así un prompt nunca sale con huecos sin rellenar.
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Falta la variable "${key}" en el prompt`);
    return vars[key];
  });
}

export function renderPrompt(role: Role, vars: Record<string, string>): string {
  return fillTemplate(readFileSync(join(PROMPT_DIR, `${role}.md`), 'utf8'), vars);
}
