#!/usr/bin/env -S npx tsx
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ShellChecks } from './checks.ts';
import { getApp, loadAppConfig, loadApps } from './config.ts';
import { DryRunGit, GitCli } from './git.ts';
import { DryRunGitHub, GhCli, TRIGGER_LABEL, type GitHub } from './github.ts';
import { makeAgents } from './agents.ts';
import { notifierFromEnv } from './notify.ts';
import { runPipeline, type PipelineResult } from './pipeline.ts';
import { MARKER } from './render.ts';
import { RunStore } from './state.ts';
import type { AppsFile } from './types.ts';
import { pendingIssues } from './watch.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Uso:
  factory run <app> <issue> [--dry-run]     Avanza un issue todo lo posible
  factory watch [--interval 300] [--once]   Procesa en bucle los issues con la etiqueta "factory"
  factory status <app> <issue>              Muestra el estado guardado

Modelos (variables de entorno opcionales):
  FACTORY_MODEL_BIG     por defecto "opus"   (spec writer, builder, approver, riesgo)
  FACTORY_MODEL_REVIEW  por defecto "sonnet" (revisor de código y reserva del de seguridad)
  FACTORY_MODEL_CODEX   por defecto el de ~/.codex/config.toml (seguridad y reserva de todos los roles)

Otras variables:
  FACTORY_APPS_DIR            carpeta con los clones de las apps (<dir>/<app>), p. ej. /srv/apps
  FACTORY_TELEGRAM_BOT_TOKEN  y FACTORY_TELEGRAM_CHAT_ID: avisos por Telegram`;

// Un solo run a la vez (la v1 no tiene paralelismo).
function acquireLock(file: string): () => void {
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`Ya hay un run en marcha (pid ${pid}). Si no es así, borra ${file}.`);
    rmSync(file);
  }
  const fd = openSync(file, 'wx');
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => rmSync(file, { force: true });
}

const log = (m: string) => console.log(`[${new Date().toLocaleTimeString('es-ES')}] ${m}`);

async function runOne(apps: AppsFile, appName: string, issue: number, dry: boolean): Promise<PipelineResult> {
  const app = getApp(apps, appName);
  const runDir = join(ROOT, 'runs', `${appName}-${issue}`);
  const realGitHub = new GhCli();
  const github: GitHub = dry ? new DryRunGitHub(realGitHub, log) : realGitHub;
  const notes: string[] = [];
  const notifier = dry ? undefined : notifierFromEnv();
  log(`${appName}#${issue}: empiezo`);
  const result = await runPipeline(
    {
      github,
      git: dry ? new DryRunGit(new GitCli(), log) : new GitCli(),
      checks: new ShellChecks({ FACTORY_EVIDENCE_DIR: join(runDir, 'evidence') }),
      agents: makeAgents({
        onFallback: (n) => {
          notes.push(n);
          log(n);
        },
      }),
      now: () => new Date().toISOString(),
      log,
      notify: notifier ? (m) => notifier.send(m) : undefined,
    },
    {
      repo: app.repo,
      repoPath: app.path,
      issue,
      approverLogin: apps.approver_login,
      config: loadAppConfig(app.path),
      store: new RunStore(runDir),
      worktree: join(runDir, 'worktree'),
      limits: { specRevisions: 3, buildRounds: 3 },
      autoApproveSpec: app.auto_approve_spec === true,
    },
  );
  if (notes.length) {
    const text = [...new Set(notes)].map((n) => `- ${n}`).join('\n');
    await github.comment(app.repo, issue, `${MARKER}\nℹ️ Avisos de esta ejecución:\n${text}`);
    await notifier?.send(`ℹ️ ${appName}#${issue}, cambio de modelo por cuota:\n${text}`);
  }
  log(`${appName}#${issue}: ${result}`);
  return result;
}

async function watch(apps: AppsFile, intervalSec: number, once: boolean) {
  const github = new GhCli();
  for (;;) {
    for (const appName of Object.keys(apps.apps)) {
      try {
        const issues = pendingIssues(await github.listIssues(apps.apps[appName].repo, TRIGGER_LABEL));
        for (const issue of issues) {
          try {
            await runOne(apps, appName, issue, false);
          } catch (e) {
            log(`${appName}#${issue}: error, se reintentará: ${e instanceof Error ? e.message : e}`);
          }
        }
      } catch (e) {
        log(`${appName}: no pude listar issues: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      interval: { type: 'string', default: '300' },
      once: { type: 'boolean', default: false },
    },
  });
  const [cmd, appName, issueArg] = positionals;
  const apps = loadApps(join(ROOT, 'apps.yml'));
  mkdirSync(join(ROOT, 'runs'), { recursive: true });

  if (cmd === 'watch') {
    const release = acquireLock(join(ROOT, 'runs', '.lock'));
    process.on('SIGINT', () => {
      release();
      process.exit(130);
    });
    try {
      log(`Vigilando ${Object.keys(apps.apps).join(', ')} cada ${values.interval} s`);
      await watch(apps, Number(values.interval), values.once);
    } finally {
      release();
    }
    return;
  }

  const issue = Number(issueArg);
  if (!cmd || !appName || !Number.isInteger(issue) || issue <= 0 || !['run', 'status'].includes(cmd)) {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
    return;
  }

  if (cmd === 'status') {
    const s = new RunStore(join(ROOT, 'runs', `${appName}-${issue}`)).load();
    console.log(JSON.stringify({ step: s.step, specRevisions: s.specRevisions, buildRounds: s.buildRounds, paused: s.paused, outcome: s.outcome }, null, 2));
    return;
  }

  const release = acquireLock(join(ROOT, 'runs', '.lock'));
  try {
    const result = await runOne(apps, appName, issue, values['dry-run']);
    process.exitCode = result === 'stuck' ? 2 : 0;
  } finally {
    release();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
