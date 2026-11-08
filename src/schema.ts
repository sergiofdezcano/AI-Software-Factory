import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';

export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

export type SchemaName = 'spec' | 'build-report' | 'findings' | 'verdict' | 'risk' | 'app-config';

export class SchemaError extends Error {
  constructor(schema: SchemaName, details: string) {
    super(`La salida no cumple el esquema "${schema}": ${details}`);
    this.name = 'SchemaError';
  }
}

const ajv = new Ajv({ allErrors: true });
const cache = new Map<SchemaName, ValidateFunction>();

export function schemaPath(name: SchemaName): string {
  return join(SCHEMA_DIR, `${name}.schema.json`);
}

export function loadSchema(name: SchemaName): object {
  return JSON.parse(readFileSync(schemaPath(name), 'utf8'));
}

export function validate<T>(name: SchemaName, data: unknown): T {
  let fn = cache.get(name);
  if (!fn) {
    fn = ajv.compile(loadSchema(name));
    cache.set(name, fn);
  }
  if (!fn(data)) {
    const details = (fn.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}${e.params && 'missingProperty' in e.params ? ` (${e.params.missingProperty})` : ''}`)
      .join('; ');
    throw new SchemaError(name, details);
  }
  return data as T;
}
