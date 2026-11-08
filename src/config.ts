import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { validate } from './schema.ts';
import type { AppConfig, AppEntry, AppsFile } from './types.ts';

export function loadApps(file: string): AppsFile {
  const data = parse(readFileSync(file, 'utf8')) as Partial<AppsFile> | null;
  if (!data?.approver_login || !data.apps || typeof data.apps !== 'object') {
    throw new Error(`${file}: faltan "approver_login" o "apps"`);
  }
  for (const [name, app] of Object.entries(data.apps)) {
    if (!app?.repo || !app?.path) throw new Error(`${file}: la app "${name}" necesita "repo" y "path"`);
  }
  return data as AppsFile;
}

// FACTORY_APPS_DIR (p. ej. /srv/apps en el servidor) sustituye la ruta local de apps.yml por <dir>/<app>.
export function getApp(apps: AppsFile, name: string, env: Record<string, string | undefined> = process.env): AppEntry {
  const app = apps.apps[name];
  if (!app) throw new Error(`App desconocida: "${name}". Registradas: ${Object.keys(apps.apps).join(', ')}`);
  const dir = env.FACTORY_APPS_DIR;
  return dir ? { ...app, path: `${dir.replace(/[\/]+$/, '')}/${name}` } : app;
}

export function loadAppConfig(repoPath: string): AppConfig {
  const file = join(repoPath, '.factory.yml');
  if (!existsSync(file)) throw new Error(`No existe ${file}. Cada app necesita un .factory.yml`);
  return validate<AppConfig>('app-config', parse(readFileSync(file, 'utf8')));
}
