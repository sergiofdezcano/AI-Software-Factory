// Clona (o actualiza) en $FACTORY_APPS_DIR/<app> cada app de apps.yml.
// Lo usa deploy/install.sh; también sirve para añadir una app nueva al servidor.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const dir = process.env.FACTORY_APPS_DIR;
if (!dir) {
  console.error('Falta FACTORY_APPS_DIR');
  process.exit(1);
}
const { apps } = parse(readFileSync(new URL('../apps.yml', import.meta.url), 'utf8'));
for (const [name, app] of Object.entries(apps)) {
  const target = join(dir, name);
  if (existsSync(join(target, '.git'))) {
    execFileSync('git', ['-C', target, 'pull', '-q', '--ff-only'], { stdio: 'inherit' });
    console.log(`${name}: actualizada`);
  } else {
    execFileSync('git', ['clone', '-q', `https://github.com/${app.repo}.git`, target], { stdio: 'inherit' });
    console.log(`${name}: clonada en ${target}`);
  }
}
