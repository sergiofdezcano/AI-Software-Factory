import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../src/state.ts';

describe('RunStore', () => {
  it('devuelve el estado inicial si no hay archivo', () => {
    const store = new RunStore(mkdtempSync(join(tmpdir(), 'run-')));
    expect(store.load()).toEqual({ step: 'spec', specRevisions: 0, buildRounds: 0, paused: false });
  });

  it('guarda y vuelve a cargar', () => {
    const store = new RunStore(mkdtempSync(join(tmpdir(), 'run-')));
    const s = store.load();
    s.step = 'build';
    s.buildRounds = 2;
    store.save(s);
    expect(new RunStore(store.dir).load()).toEqual(s);
  });

  it('numera los artefactos en orden y sobrevive a reinicios', () => {
    const store = new RunStore(join(mkdtempSync(join(tmpdir(), 'run-')), 'nested'));
    store.artifact('spec-prompt.md', 'hola');
    store.artifact('spec.json', { a: 1 });
    new RunStore(store.dir).artifact('build.json', { b: 2 });
    const files = readdirSync(store.dir).filter((f) => f !== 'state.json').sort();
    expect(files).toEqual(['001-spec-prompt.md', '002-spec.json', '003-build.json']);
    expect(JSON.parse(readFileSync(join(store.dir, '002-spec.json'), 'utf8'))).toEqual({ a: 1 });
  });
});
