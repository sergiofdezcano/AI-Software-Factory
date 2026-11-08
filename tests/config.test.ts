import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApps, getApp, loadAppConfig } from '../src/config.ts';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'factory-cfg-'));
}

describe('config', () => {
  it('lee apps.yml', () => {
    const dir = tmp();
    const file = join(dir, 'apps.yml');
    writeFileSync(file, 'approver_login: sergio\napps:\n  landing:\n    repo: o/landing\n    path: C:/x/landing\n');
    const apps = loadApps(file);
    expect(apps.approver_login).toBe('sergio');
    expect(getApp(apps, 'landing').repo).toBe('o/landing');
    expect(() => getApp(apps, 'nope')).toThrow(/nope/);
  });

  it('lee y valida .factory.yml', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.factory.yml'), 'check: npm run check\nlow_risk_paths:\n  - src/data/*.json\ndefault_branch: main\n');
    expect(loadAppConfig(dir).low_risk_paths).toEqual(['src/data/*.json']);
  });

  it('falla si falta .factory.yml o es inválido', () => {
    const dir = tmp();
    expect(() => loadAppConfig(dir)).toThrow(/\.factory\.yml/);
    writeFileSync(join(dir, '.factory.yml'), 'check: x\n');
    expect(() => loadAppConfig(dir)).toThrow(/app-config/);
  });
});

describe('FACTORY_APPS_DIR', () => {
  it('sustituye la ruta local de cada app', () => {
    const apps = { approver_login: 's', apps: { landing: { repo: 'o/l', path: 'C:/x/landing' } } };
    expect(getApp(apps, 'landing', { FACTORY_APPS_DIR: '/srv/apps' }).path).toBe('/srv/apps/landing');
    expect(getApp(apps, 'landing', {}).path).toBe('C:/x/landing');
  });
});
