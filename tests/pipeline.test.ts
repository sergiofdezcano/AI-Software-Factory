import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline, type Agents, type PipelineContext, type PipelineDeps } from '../src/pipeline.ts';
import { RunStore } from '../src/state.ts';
import { QuotaError, type AgentCall, type AgentRunner } from '../src/runners/types.ts';
import type { GitHub, Issue, StatusLabel } from '../src/github.ts';
import type { Git } from '../src/git.ts';
import type { Checks } from '../src/checks.ts';
import type { CheckStatus } from '../src/types.ts';
import { validSpec } from './fixtures.ts';

// ---------- dobles ----------

let clock = Date.parse("2026-01-01T00:00:00Z");
const tick = () => new Date((clock += 1000)).toISOString();

class FakeGitHub implements GitHub {
  issue: Issue = { title: 'Añadir micrófono', body: 'Añade el micro al setup', labels: ['factory'], comments: [] };
  comments: string[] = [];
  statuses: StatusLabel[] = [];
  prs: string[] = [];
  merged: string[] = [];
  async getIssue() {
    return structuredClone(this.issue);
  }
  async listIssues() {
    return [];
  }
  async comment(_r: string, _i: number, body: string) {
    this.comments.push(body);
  }
  async setStatus(_r: string, _i: number, label: StatusLabel) {
    this.statuses.push(label);
  }
  async createPR(_r: string, pr: { body: string }) {
    this.prs.push(pr.body);
    return 'https://github.com/o/r/pull/1';
  }
  async mergePR(_r: string, url: string) {
    this.merged.push(url);
  }
  reply(body: string, author = 'sergio') {
    this.issue.comments.push({ author, body, createdAt: tick() });
  }
}

class FakeGit implements Git {
  files = ['src/data/setup.json'];
  pushed = false;
  removed = false;
  async createWorktree(_r: string, wt: string) {
    mkdirSync(join(wt, 'src', 'data'), { recursive: true });
    writeFileSync(join(wt, 'src', 'data', 'setup.json'), '{"items": [{"name": "Shure SM7B"}]}');
  }
  async changedFiles() {
    return this.files;
  }
  async diff() {
    return '+ {"name": "Shure SM7B"}';
  }
  async trackedFiles() {
    return ['src/data/setup.json'];
  }
  async commitAll() {
    return false;
  }
  async push() {
    this.pushed = true;
  }
  async removeWorktree() {
    this.removed = true;
  }
}

class FakeChecks implements Checks {
  queue: CheckStatus[] = [];
  ran: string[] = [];
  async run(name: string) {
    this.ran.push(name);
    return { name, status: this.queue.shift() ?? ('passed' as CheckStatus), output: 'salida' };
  }
}

type Responder = (call: AgentCall) => unknown;
class FakeAgent implements AgentRunner {
  calls: AgentCall[] = [];
  constructor(readonly name: string, private responders: Responder[]) {}
  async run(call: AgentCall) {
    this.calls.push(call);
    const r = this.responders.length > 1 ? this.responders.shift()! : this.responders[0];
    const data = r(call);
    return { raw: JSON.stringify(data), data };
  }
}

const report = { summary: 'Añadido', criteria: [{ id: 'A1', status: 'done', evidence: 'test verde' }], notes: '' };
const approve = { decision: 'approve', changes: [], reason: 'Todo bien' };
const changes = { decision: 'changes', changes: ['Renombra X'], reason: 'Falta algo' };
const noFindings = { findings: [] };

function makeAgents(over: Partial<Record<keyof Agents, Responder[]>> = {}): Record<keyof Agents, FakeAgent> {
  return {
    specWriter: new FakeAgent('spec', over.specWriter ?? [() => validSpec]),
    builder: new FakeAgent('builder', over.builder ?? [() => report]),
    reviewerCode: new FakeAgent('code', over.reviewerCode ?? [() => noFindings]),
    reviewerSecurity: new FakeAgent('sec', over.reviewerSecurity ?? [() => noFindings]),
    approver: new FakeAgent('approver', over.approver ?? [() => approve]),
    riskClassifier: new FakeAgent('risk', over.riskClassifier ?? [() => ({ level: 'low', reason: 'Solo datos' })]),
  };
}

let gh: FakeGitHub, git: FakeGit, checks: FakeChecks, ctx: PipelineContext;

function deps(agents: Agents): PipelineDeps {
  return { github: gh, git, checks, agents, now: tick, log: () => {} };
}

beforeEach(() => {
  gh = new FakeGitHub();
  git = new FakeGit();
  checks = new FakeChecks();
  const root = mkdtempSync(join(tmpdir(), 'pipe-'));
  ctx = {
    repo: 'o/landing',
    repoPath: join(root, 'repo'),
    issue: 12,
    approverLogin: 'sergio',
    config: { check: 'npm run check', screenshots: 'node shot.mjs', low_risk_paths: ['src/data/*.json'], default_branch: 'main' },
    store: new RunStore(join(root, 'run')),
    worktree: join(root, 'wt'),
    limits: { specRevisions: 3, buildRounds: 3 },
  };
});

// ---------- tests ----------

describe('pipeline', () => {
  it('se para esperando la aprobación de la spec', async () => {
    const agents = makeAgents();
    expect(await runPipeline(deps(agents), ctx)).toBe('waiting');
    expect(gh.comments[0]).toContain('Spec propuesta');
    expect(gh.statuses).toEqual(['factory:spec', 'factory:awaiting-spec']);
    expect(ctx.store.load().step).toBe('await_approval');
    expect(agents.builder.calls).toHaveLength(0);
    // sin respuesta, volver a ejecutar sigue esperando sin repetir la spec
    expect(await runPipeline(deps(agents), ctx)).toBe('waiting');
    expect(agents.specWriter.calls).toHaveLength(1);
  });

  it('camino feliz: /approve hasta automerge', async () => {
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(checks.ran).toEqual(['check', 'screenshots']);
    expect(agents.reviewerCode.calls[0].mode).toBe('read');
    expect(agents.builder.calls[0].mode).toBe('write');
    expect(git.pushed).toBe(true);
    expect(gh.merged).toHaveLength(1);
    expect(gh.statuses.at(-1)).toBe('factory:merged');
    expect(git.removed).toBe(true);
    expect(ctx.store.load().outcome?.kind).toBe('merged');
  });

  it('ignora /approve de otra persona', async () => {
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve', 'intruso');
    expect(await runPipeline(deps(agents), ctx)).toBe('waiting');
  });

  it('ruta fuera de bajo riesgo: PR sin consultar al clasificador', async () => {
    git.files = ['src/data/setup.json', 'src/components/Setup.astro'];
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(agents.riskClassifier.calls).toHaveLength(0);
    expect(gh.merged).toHaveLength(0);
    expect(gh.prs[0]).toContain('src/components/Setup.astro');
    expect(gh.statuses.at(-1)).toBe('factory:pr');
  });

  it('el clasificador puede subir el riesgo', async () => {
    const agents = makeAgents({ riskClassifier: [() => ({ level: 'high', reason: 'Cambia la portada' })] });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    await runPipeline(deps(agents), ctx);
    expect(gh.merged).toHaveLength(0);
    expect(gh.prs[0]).toContain('Cambia la portada');
  });

  it('/revise vuelve al spec writer con el comentario', async () => {
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/revise que sea un Rode');
    expect(await runPipeline(deps(agents), ctx)).toBe('waiting');
    expect(agents.specWriter.calls).toHaveLength(2);
    expect(agents.specWriter.calls[1].prompt).toContain('que sea un Rode');
    expect(gh.comments[1]).toContain('versión 2');
  });

  it('demasiadas revisiones de spec => stuck', async () => {
    ctx.limits.specRevisions = 1;
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/revise a');
    await runPipeline(deps(agents), ctx);
    gh.issue.comments = [];
    gh.reply('/revise b');
    expect(await runPipeline(deps(agents), ctx)).toBe('stuck');
    expect(gh.statuses.at(-1)).toBe('factory:stuck');
  });

  it('un control fallido vuelve al builder con la salida', async () => {
    checks.queue = ['failed'];
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(agents.builder.calls).toHaveLength(2);
    expect(agents.builder.calls[1].prompt).toContain('salida');
  });

  it('un criterio sin hacer cuenta como no ejecutado y vuelve al builder', async () => {
    const notDone = { ...report, criteria: [{ id: 'A1', status: 'not_done', evidence: '' }] };
    const agents = makeAgents({ builder: [() => notDone, () => report] });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    await runPipeline(deps(agents), ctx);
    expect(agents.builder.calls).toHaveLength(2);
    expect(agents.builder.calls[1].prompt).toContain('A1');
  });

  it('changes del approver vuelve al builder solo con la lista', async () => {
    const agents = makeAgents({ approver: [() => changes, () => approve] });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(agents.builder.calls[1].prompt).toContain('Renombra X');
  });

  it('agotar las vueltas de construcción => stuck', async () => {
    const agents = makeAgents({ approver: [() => changes] });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('stuck');
    expect(agents.builder.calls).toHaveLength(3);
    expect(gh.comments.at(-1)).toContain('Renombra X');
  });

  it('descarta hallazgos con citas inventadas', async () => {
    const fake = { findings: [{ file: 'src/data/setup.json', line: 1, severity: 'blocker', description: 'x', quote: 'eval(bad)' }] };
    const agents = makeAgents({ reviewerSecurity: [() => fake] });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    await runPipeline(deps(agents), ctx);
    expect(gh.merged).toHaveLength(1);
    expect(ctx.store.load().findings?.dropped).toHaveLength(1);
  });

  it('un blocker verificado anula el approve del approver', async () => {
    const real = { findings: [{ file: 'src/data/setup.json', line: 1, severity: 'blocker', description: 'x', quote: '"Shure SM7B"' }] };
    const agents = makeAgents({ reviewerSecurity: [() => real, () => noFindings] });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(agents.builder.calls).toHaveLength(2);
  });

  it('cuota agotada => paused y luego reanuda donde estaba', async () => {
    let fail = true;
    const agents = makeAgents({
      builder: [
        () => {
          if (fail) throw new QuotaError('usage limit');
          return report;
        },
      ],
    });
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    expect(await runPipeline(deps(agents), ctx)).toBe('paused');
    expect(gh.statuses.at(-1)).toBe('factory:paused');
    fail = false;
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(ctx.store.load().buildRounds).toBe(1);
  });

  it('reintenta una vez si la salida no cumple el esquema', async () => {
    const agents = makeAgents({ specWriter: [() => ({ title: 'x' }), () => validSpec] });
    expect(await runPipeline(deps(agents), ctx)).toBe('waiting');
    expect(agents.specWriter.calls[1].prompt).toContain('no cumplía el esquema');
  });

  it('no hace nada si el issue no tiene la etiqueta factory', async () => {
    gh.issue.labels = [];
    await expect(runPipeline(deps(makeAgents()), ctx)).rejects.toThrow(/etiqueta/);
  });

  it('un run terminado no se repite', async () => {
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    gh.reply('/approve');
    await runPipeline(deps(agents), ctx);
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(gh.merged).toHaveLength(1);
  });
});

describe('autoaprobación', () => {
  it('con autoApproveSpec la spec se aprueba sola y queda registrado en el issue', async () => {
    ctx.autoApproveSpec = true;
    const agents = makeAgents();
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(gh.comments.some((c) => c.includes('aprobada automáticamente'))).toBe(true);
    expect(gh.merged).toHaveLength(1);
  });
});

describe('entrega robusta', () => {
  it('si falla la limpieza, el run termina igual y no repite comentarios al reintentar', async () => {
    ctx.autoApproveSpec = true;
    git.removeWorktree = async () => {
      throw new Error('Permission denied');
    };
    expect(await runPipeline(deps(makeAgents()), ctx)).toBe('done');
    const comments = gh.comments.length;
    expect(await runPipeline(deps(makeAgents()), ctx)).toBe('done');
    expect(gh.comments.length).toBe(comments);
    expect(gh.merged).toHaveLength(1);
  });

  it('un ship interrumpido tras anunciar solo limpia', async () => {
    ctx.autoApproveSpec = true;
    const agents = makeAgents();
    await runPipeline(deps(agents), ctx);
    const s = ctx.store.load();
    s.step = 'ship';
    ctx.store.save(s);
    const before = gh.comments.length;
    expect(await runPipeline(deps(agents), ctx)).toBe('done');
    expect(gh.comments.length).toBe(before);
    expect(gh.merged).toHaveLength(1);
  });
});
