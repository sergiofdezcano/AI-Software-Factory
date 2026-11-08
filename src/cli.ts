#!/usr/bin/env -S npx tsx
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ShellChecks } from './checks.ts';
import { getApp, loadAppConfig, loadApps } from './config.ts';
import { DryRunGit, GitCli } from './git.ts';
import { DryRunGitHub, GhCli } from './github.ts';
import { runPipeline, type Agents } from './pipeline.ts';
import { ClaudeRunner } from './runners/claude.ts';
import { CodexRunner } from './runners/codex.ts';
import { RunStore } from './state.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Uso:
  factory run <app> <issue> [--dry-run]   Avanza la tarea todo lo posible
  factory status <app> <issue>            Muestra el estado guardado

Modelos (variables de entorno opcionales):
  FACTORY_MODEL_BIG     por defecto "opus"   (spec writer, builder, approver, riesgo)
  FACTORY_MODEL_REVIEW  por defecto "sonnet" (revisor de código)
  FACTORY_MODEL_CODEX   por defecto el de ~/.codex/config.toml (revisor de seguridad)`;

function makeAgents(): Agents {
  const big = process.env.FACTORY_MODEL_BIG ?? 'opus';
  const review = process.env.FACTORY_MODEL_REVIEW ?? 'sonnet';
  return {
    specWriter: new ClaudeRunner({ model: big }),
    builder: new ClaudeRunner({ model: big }),
    reviewerCode: new ClaudeRunner({ model: review }),
    reviewerSecurity: new CodexRunner({ model: process.env.FACTORY_MODEL_CODEX }),
    approver: new ClaudeRunner({ model: big }),
    riskClassifier: new ClaudeRunner({ model: big }),
  };
}

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

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'dry-run': { type: 'boolean', default: false } } });
  const [cmd, appName, issueArg] = positionals;
  const issue = Number(issueArg);
  if (!cmd || !appName || !Number.isInteger(issue) || issue <= 0) {
    console.log(USAGE);
    process.exit(cmd ? 1 : 0);
  }

  const apps = loadApps(join(ROOT, 'apps.yml'));
  const app = getApp(apps, appName);
  const runDir = join(ROOT, 'runs', `${appName}-${issue}`);
  const store = new RunStore(runDir);

  if (cmd === 'status') {
    const s = store.load();
    console.log(JSON.stringify({ step: s.step, specRevisions: s.specRevisions, buildRounds: s.buildRounds, paused: s.paused, outcome: s.outcome }, null, 2));
    return;
  }
  if (cmd !== 'run') {
    console.log(USAGE);
    process.exit(1);
  }

  const dry = values['dry-run'];
  const log = (m: string) => console.log(m);
  mkdirSync(join(ROOT, 'runs'), { recursive: true });
  const release = acquireLock(join(ROOT, 'runs', '.lock'));
  try {
    const result = await runPipeline(
      {
        github: dry ? new DryRunGitHub(new GhCli(), log) : new GhCli(),
        git: dry ? new DryRunGit(new GitCli(), log) : new GitCli(),
        checks: new ShellChecks({ FACTORY_EVIDENCE_DIR: join(runDir, 'evidence') }),
        agents: makeAgents(),
        now: () => new Date().toISOString(),
        log,
      },
      {
        repo: app.repo,
        repoPath: app.path,
        issue,
        approverLogin: apps.approver_login,
        config: loadAppConfig(app.path),
        store,
        worktree: join(runDir, 'worktree'),
        limits: { specRevisions: 3, buildRounds: 3 },
      },
    );
    console.log(`Resultado: ${result}`);
    process.exitCode = result === 'stuck' ? 2 : 0;
  } finally {
    release();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
