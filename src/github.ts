import type { IssueComment } from './commands.ts';
import { realExec, type Exec } from './runners/types.ts';

export const STATUS_LABELS = [
  'factory:spec',
  'factory:awaiting-spec',
  'factory:building',
  'factory:reviewing',
  'factory:pr',
  'factory:merged',
  'factory:stuck',
  'factory:paused',
] as const;
export type StatusLabel = (typeof STATUS_LABELS)[number];
export const TRIGGER_LABEL = 'factory';

export interface Issue {
  title: string;
  body: string;
  labels: string[];
  comments: IssueComment[];
}

export interface GitHub {
  getIssue(repo: string, issue: number): Promise<Issue>;
  comment(repo: string, issue: number, body: string): Promise<void>;
  setStatus(repo: string, issue: number, label: StatusLabel): Promise<void>;
  createPR(repo: string, pr: { head: string; base: string; title: string; body: string }): Promise<string>;
  mergePR(repo: string, url: string): Promise<void>;
}

const LABEL_COLORS: Record<StatusLabel, string> = {
  'factory:spec': 'c5def5',
  'factory:awaiting-spec': 'fbca04',
  'factory:building': '1d76db',
  'factory:reviewing': '5319e7',
  'factory:pr': '0e8a16',
  'factory:merged': '0e8a16',
  'factory:stuck': 'b60205',
  'factory:paused': 'd4c5f9',
};

export class GhCli implements GitHub {
  private labelsReady = new Set<string>();

  constructor(private exec: Exec = realExec, private cwd = process.cwd()) {}

  private async gh(args: string[], input?: string): Promise<string> {
    const r = await this.exec('gh', args, { cwd: this.cwd, input, timeoutMs: 120_000 });
    if (r.exitCode !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} falló: ${r.stderr.trim() || r.stdout.trim()}`);
    return r.stdout;
  }

  async getIssue(repo: string, issue: number): Promise<Issue> {
    const out = await this.gh(['issue', 'view', String(issue), '-R', repo, '--json', 'title,body,labels,comments']);
    const j = JSON.parse(out) as {
      title: string;
      body: string;
      labels: { name: string }[];
      comments: { author: { login: string } | null; body: string; createdAt: string }[];
    };
    return {
      title: j.title,
      body: j.body ?? '',
      labels: j.labels.map((l) => l.name),
      comments: j.comments.map((c) => ({ author: c.author?.login ?? '', body: c.body, createdAt: c.createdAt })),
    };
  }

  async comment(repo: string, issue: number, body: string): Promise<void> {
    await this.gh(['issue', 'comment', String(issue), '-R', repo, '--body-file', '-'], body);
  }

  private async ensureLabels(repo: string) {
    if (this.labelsReady.has(repo)) return;
    for (const label of STATUS_LABELS) {
      await this.gh(['label', 'create', label, '-R', repo, '--color', LABEL_COLORS[label], '--force', '--description', 'AI Software Factory']);
    }
    this.labelsReady.add(repo);
  }

  async setStatus(repo: string, issue: number, label: StatusLabel): Promise<void> {
    await this.ensureLabels(repo);
    const current = (await this.getIssue(repo, issue)).labels.filter((l) => l.startsWith('factory:') && l !== label);
    const args = ['issue', 'edit', String(issue), '-R', repo, '--add-label', label];
    if (current.length) args.push('--remove-label', current.join(','));
    await this.gh(args);
  }

  async createPR(repo: string, pr: { head: string; base: string; title: string; body: string }): Promise<string> {
    const out = await this.gh(['pr', 'create', '-R', repo, '--head', pr.head, '--base', pr.base, '--title', pr.title, '--body-file', '-'], pr.body);
    return out.trim().split(/\s+/).pop() ?? '';
  }

  async mergePR(repo: string, url: string): Promise<void> {
    await this.gh(['pr', 'merge', url, '-R', repo, '--squash', '--delete-branch']);
  }
}

// Lee de GitHub de verdad pero solo registra las escrituras.
export class DryRunGitHub implements GitHub {
  readonly writes: string[] = [];

  constructor(private inner: GitHub, private log: (msg: string) => void = console.log) {}

  getIssue(repo: string, issue: number) {
    return this.inner.getIssue(repo, issue);
  }
  private record(msg: string) {
    this.writes.push(msg);
    this.log(`[dry-run] ${msg}`);
  }
  async comment(repo: string, issue: number, body: string) {
    this.record(`comentario en ${repo}#${issue}:\n${body}`);
  }
  async setStatus(repo: string, issue: number, label: StatusLabel) {
    this.record(`etiqueta ${label} en ${repo}#${issue}`);
  }
  async createPR(repo: string, pr: { head: string; base: string; title: string; body: string }) {
    this.record(`PR ${pr.head} -> ${pr.base} en ${repo}: ${pr.title}\n${pr.body}`);
    return `https://github.com/${repo}/pull/DRY-RUN`;
  }
  async mergePR(repo: string, url: string) {
    this.record(`merge ${url}`);
  }
}
