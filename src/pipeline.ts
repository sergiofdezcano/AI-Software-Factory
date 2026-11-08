import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Checks } from './checks.ts';
import { parseApproval } from './commands.ts';
import { verifyFindings } from './findings.ts';
import type { Git } from './git.ts';
import { TRIGGER_LABEL, type GitHub } from './github.ts';
import { renderPrompt, type Role } from './prompts.ts';
import { MARKER, prBody, specToMarkdown } from './render.ts';
import { automergeBlockers, combineRisk, rulesRisk } from './risk.ts';
import { AgentError, QuotaError, type AgentRunner } from './runners/types.ts';
import { SchemaError, validate, type SchemaName } from './schema.ts';
import type { RunStore } from './state.ts';
import type { AppConfig, BuildReport, CheckResult, Findings, RiskAssessment, RunState, Spec, Verdict } from './types.ts';

export interface Agents {
  specWriter: AgentRunner;
  builder: AgentRunner;
  reviewerCode: AgentRunner;
  reviewerSecurity: AgentRunner;
  approver: AgentRunner;
  riskClassifier: AgentRunner;
}

export interface PipelineDeps {
  github: GitHub;
  git: Git;
  checks: Checks;
  agents: Agents;
  now: () => string;
  log: (msg: string) => void;
}

export interface PipelineContext {
  repo: string; // owner/name
  repoPath: string; // clon local de la app
  issue: number;
  approverLogin: string;
  config: AppConfig;
  store: RunStore;
  worktree: string;
  limits: { specRevisions: number; buildRounds: number };
  autoApproveSpec?: boolean;
}

export type PipelineResult = 'waiting' | 'done' | 'stuck' | 'paused';

class Stuck extends Error {}

const MIN = 60_000;
const json = (v: unknown) => '```json\n' + JSON.stringify(v, null, 2) + '\n```';
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'tarea';

// Concatena todos los .md de brain/ para pasárselos a los agentes.
export function readBrain(root: string): string {
  const dir = join(root, 'brain');
  if (!existsSync(dir)) return '_La app aún no tiene brain/._';
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.md')) files.push(p);
    }
  };
  walk(dir);
  if (!files.length) return '_brain/ está vacío._';
  return files.map((f) => `### ${relative(root, f).replace(/\\/g, '/')}\n\n${readFileSync(f, 'utf8')}`).join('\n\n');
}

export async function runPipeline(deps: PipelineDeps, ctx: PipelineContext): Promise<PipelineResult> {
  const { github, git, checks, agents, log } = deps;
  const { store, config, worktree } = ctx;
  const state = store.load();
  if (state.step === 'done') return 'done';
  if (state.step === 'stuck') return 'stuck';

  const issue = await github.getIssue(ctx.repo, ctx.issue);
  if (!issue.labels.includes(TRIGGER_LABEL)) {
    throw new Error(`El issue #${ctx.issue} no tiene la etiqueta "${TRIGGER_LABEL}"; la fábrica no lo toca.`);
  }

  const timeouts = {
    agent: (config.timeouts?.agent_minutes ?? 15) * MIN,
    builder: (config.timeouts?.builder_minutes ?? 60) * MIN,
    check: (config.timeouts?.check_minutes ?? 20) * MIN,
  };
  const save = () => store.save(state);
  const go = (step: RunState['step']) => {
    state.step = step;
    save();
    log(`→ ${step}`);
  };

  // Llama a un agente, guarda prompt y salida, valida contra el esquema y reintenta una vez.
  async function ask<T>(agent: AgentRunner, role: Role, schema: SchemaName, vars: Record<string, string>, mode: 'read' | 'write', timeoutMs: number): Promise<T> {
    let prompt = renderPrompt(role, vars);
    for (let attempt = 1; ; attempt++) {
      store.artifact(`${role}-prompt.md`, prompt);
      log(`  ${role} (${agent.name})…`);
      const started = Date.now();
      const out = await agent.run({ prompt, cwd: worktree, schema, mode, timeoutMs });
      store.artifact(`${role}-output.json`, { agent: agent.name, ms: Date.now() - started, raw: out.raw, data: out.data });
      try {
        return validate<T>(schema, out.data);
      } catch (e) {
        if (!(e instanceof SchemaError) || attempt >= 2) throw new AgentError(`${role}: ${(e as Error).message}`);
        prompt = `${prompt}\n\n## Atención\nTu respuesta anterior no cumplía el esquema: ${e.message}\nDevuelve el JSON correcto.`;
      }
    }
  }

  async function fail(reason: string): Promise<PipelineResult> {
    state.outcome = { kind: 'stuck', reason };
    go('stuck');
    await github.setStatus(ctx.repo, ctx.issue, 'factory:stuck');
    await github.comment(ctx.repo, ctx.issue, `${MARKER}\n🛑 La fábrica se ha detenido.\n\n${reason}\n\nEl worktree sigue en \`${worktree}\` y el registro en \`${store.dir}\`.`);
    return 'stuck';
  }

  try {
    if (state.paused) {
      state.paused = false;
      save();
    }
    for (;;) {
      switch (state.step) {
        case 'spec': {
          await github.setStatus(ctx.repo, ctx.issue, 'factory:spec');
          if (!state.branch) {
            state.branch = `factory/${ctx.issue}-${slug(issue.title)}`;
            state.worktree = worktree;
            save();
          }
          await git.createWorktree(ctx.repoPath, worktree, state.branch, config.default_branch);
          if (config.setup && !existsSync(join(worktree, 'node_modules'))) {
            const r = await checks.run('setup', config.setup, worktree, timeouts.check);
            store.artifact('setup.json', r);
            if (r.status !== 'passed') throw new Stuck(`Falló la preparación (\`${config.setup}\`):\n\n\`\`\`\n${r.output}\n\`\`\``);
          }
          const comments = issue.comments.filter((c) => !c.body.includes(MARKER)).map((c) => `**${c.author}** (${c.createdAt}):\n${c.body}`);
          const revision = state.reviseNote
            ? `## Revisión pedida por el usuario\n${state.reviseNote}\n\n## Tu spec anterior\n${json(state.spec)}`
            : '';
          const spec = await ask<Spec>(
            agents.specWriter,
            'spec-writer',
            'spec',
            {
              issue_number: String(ctx.issue),
              issue_title: issue.title,
              issue_body: issue.body || '_Sin descripción._',
              issue_comments: comments.join('\n\n') || '_Sin comentarios._',
              app_config: json(config),
              brain: readBrain(worktree),
              files: (await git.trackedFiles(worktree)).join('\n'),
              revision,
            },
            'read',
            timeouts.agent,
          );
          state.spec = spec;
          state.specCommentAt = deps.now();
          await github.comment(ctx.repo, ctx.issue, specToMarkdown(spec, state.specRevisions + 1));
          await github.setStatus(ctx.repo, ctx.issue, 'factory:awaiting-spec');
          go('await_approval');
          break;
        }

        case 'await_approval': {
          let decision = parseApproval(issue.comments, state.specCommentAt ?? deps.now(), ctx.approverLogin);
          if (!decision && ctx.autoApproveSpec) {
            decision = { kind: 'approve' };
            await github.comment(ctx.repo, ctx.issue, `${MARKER}
🤖 Spec aprobada automáticamente (auto_approve_spec en apps.yml). Empiezo a construir.`);
          }
          if (!decision) {
            log(`Esperando /approve o /revise de ${ctx.approverLogin} en #${ctx.issue}.`);
            return 'waiting';
          }
          if (decision.kind === 'revise') {
            state.specRevisions++;
            if (state.specRevisions > ctx.limits.specRevisions) {
              return await fail(`Se superó el máximo de ${ctx.limits.specRevisions} revisiones de la spec.`);
            }
            state.reviseNote = decision.text;
            go('spec');
            break;
          }
          state.reviseNote = undefined;
          await github.setStatus(ctx.repo, ctx.issue, 'factory:building');
          go('build');
          break;
        }

        case 'build': {
          if (state.buildRounds >= ctx.limits.buildRounds) {
            const pending = state.builderFeedback?.length ? `\n\nLo último pendiente:\n${state.builderFeedback.map((f) => `- ${f}`).join('\n')}` : '';
            return await fail(`Se agotaron las ${ctx.limits.buildRounds} vueltas de construcción.${pending}`);
          }
          await github.setStatus(ctx.repo, ctx.issue, 'factory:building');
          const feedback = state.builderFeedback?.length
            ? `## Corrige esto (vuelta ${state.buildRounds + 1})\nTu trabajo anterior ya está en la rama. Arregla SOLO lo siguiente:\n${state.builderFeedback.map((f) => `- ${f}`).join('\n')}`
            : '';
          const report = await ask<BuildReport>(
            agents.builder,
            'builder',
            'build-report',
            { branch: state.branch!, check_command: config.check, spec: json(state.spec), brain: readBrain(worktree), feedback },
            'write',
            timeouts.builder,
          );
          state.buildRounds++;
          state.buildReport = report;
          await git.commitAll(worktree, `factory: cambios pendientes del builder (#${ctx.issue})`);
          go('checks');
          break;
        }

        case 'checks': {
          const results: CheckResult[] = [await checks.run('check', config.check, worktree, timeouts.check)];
          if (config.screenshots) results.push(await checks.run('screenshots', config.screenshots, worktree, timeouts.check));
          for (const a of state.spec!.acceptance) {
            const c = state.buildReport!.criteria.find((x) => x.id === a.id);
            if (!c || c.status !== 'done' || !c.evidence.trim()) {
              results.push({ name: `criterio ${a.id}`, status: 'not_run', output: `Sin evidencia para: ${a.criterion}` });
            }
          }
          state.checks = results;
          store.artifact('checks.json', results);
          await git.commitAll(worktree, `factory: artefactos de los controles (#${ctx.issue})`);
          const bad = results.filter((r) => r.status !== 'passed');
          if (bad.length) {
            state.builderFeedback = bad.map((r) => `Control "${r.name}" ${r.status}:\n${r.output}`);
            go('build');
            break;
          }
          await github.setStatus(ctx.repo, ctx.issue, 'factory:reviewing');
          go('review');
          break;
        }

        case 'review': {
          const vars = { spec: json(state.spec), diff: await git.diff(worktree, config.default_branch) };
          const [code, sec] = await Promise.all([
            ask<Findings>(agents.reviewerCode, 'reviewer-code', 'findings', vars, 'read', timeouts.agent),
            ask<Findings>(agents.reviewerSecurity, 'reviewer-security', 'findings', vars, 'read', timeouts.agent),
          ]);
          const read = (p: string) => {
            const abs = join(worktree, p);
            return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
          };
          state.findings = verifyFindings([...code.findings, ...sec.findings], read);
          store.artifact('findings-verified.json', state.findings);
          go('approve');
          break;
        }

        case 'approve': {
          let verdict = await ask<Verdict>(
            agents.approver,
            'approver',
            'verdict',
            {
              spec: json(state.spec),
              report: json(state.buildReport),
              checks: json(state.checks?.map(({ name, status }) => ({ name, status }))),
              findings: json(state.findings?.kept ?? []),
            },
            'read',
            timeouts.agent,
          );
          // El código manda: no se aprueba con controles sin pasar o blockers verificados.
          const forced = [
            ...(state.checks ?? []).filter((c) => c.status !== 'passed').map((c) => `Control "${c.name}" en ${c.status}.`),
            ...(state.findings?.kept ?? [])
              .filter((f) => f.severity === 'blocker')
              .map((f) => `Arregla ${f.file}:${f.line}: ${f.description}`),
          ];
          if (verdict.decision === 'approve' && forced.length) {
            verdict = { decision: 'changes', changes: forced, reason: 'Aprobación anulada por la fábrica: hay bloqueos verificados.' };
          }
          state.verdict = verdict;
          if (verdict.decision === 'changes') {
            state.builderFeedback = verdict.changes.length ? verdict.changes : [verdict.reason];
            go('build');
            break;
          }
          state.builderFeedback = undefined;
          go('risk');
          break;
        }

        case 'risk': {
          const files = await git.changedFiles(worktree, config.default_branch);
          const rules = rulesRisk(files, config.low_risk_paths);
          let classifier: RiskAssessment | undefined;
          if (rules.level === 'low') {
            classifier = await ask<RiskAssessment>(
              agents.riskClassifier,
              'risk-classifier',
              'risk',
              { spec: json(state.spec), diff: await git.diff(worktree, config.default_branch) },
              'read',
              timeouts.agent,
            );
          }
          state.risk = combineRisk(rules, classifier);
          go('ship');
          break;
        }

        case 'ship': {
          const blockers = automergeBlockers({
            risk: state.risk!.level,
            checks: state.checks ?? [],
            decision: state.verdict!.decision,
            findings: state.findings?.kept ?? [],
          });
          await git.push(worktree, state.branch!);
          if (!state.outcome?.url) {
            const url = await github.createPR(ctx.repo, {
              head: state.branch!,
              base: config.default_branch,
              title: `${state.spec!.title} (#${ctx.issue})`,
              body: prBody({
                issue: ctx.issue,
                spec: state.spec!,
                report: state.buildReport!,
                checks: state.checks ?? [],
                findings: state.findings?.kept ?? [],
                dropped: state.findings?.dropped.length ?? 0,
                risk: state.risk!,
                blockers,
              }),
            });
            state.outcome = { kind: 'pr', url };
            save();
          }
          const url = state.outcome.url!;
          if (blockers.length === 0) {
            await github.mergePR(ctx.repo, url);
            state.outcome = { kind: 'merged', url };
            await github.setStatus(ctx.repo, ctx.issue, 'factory:merged');
            await github.comment(ctx.repo, ctx.issue, `${MARKER}\n✅ Cambio de bajo riesgo mergeado automáticamente: ${url}`);
          } else {
            await github.setStatus(ctx.repo, ctx.issue, 'factory:pr');
            await github.comment(
              ctx.repo,
              ctx.issue,
              `${MARKER}\n👀 PR lista para que la revises: ${url}\n\nNo se mergeó sola porque:\n${blockers.map((b) => `- ${b}`).join('\n')}`,
            );
          }
          await git.removeWorktree(ctx.repoPath, worktree);
          go('done');
          return 'done';
        }

        default:
          return state.step === 'stuck' ? 'stuck' : 'done';
      }
    }
  } catch (e) {
    if (e instanceof QuotaError) {
      state.paused = true;
      save();
      await github.setStatus(ctx.repo, ctx.issue, 'factory:paused');
      log(`Pausado por límite de uso: ${e.message}`);
      return 'paused';
    }
    if (e instanceof AgentError || e instanceof Stuck) return await fail(e.message);
    throw e;
  }
}
