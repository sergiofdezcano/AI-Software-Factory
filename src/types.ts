// Tipos compartidos. Los esquemas JSON de schemas/ son la fuente de verdad
// para lo que devuelven los agentes; estos tipos los reflejan.

export type EvidenceKind = 'test' | 'command' | 'screenshot';

export interface Story {
  action: string;
  conditions: string;
  permissions: string;
  expected_result: string;
}

export interface MustRespect {
  path: string;
  reason: string;
}

export interface Acceptance {
  id: string;
  criterion: string;
  proof: EvidenceKind;
  evidence: string;
}

export interface BrainUpdate {
  path: string;
  change: string;
}

export interface Spec {
  title: string;
  summary: string;
  stories: Story[];
  must_respect: MustRespect[];
  acceptance: Acceptance[];
  out_of_scope: string[];
  open_questions: string[];
  brain_updates: BrainUpdate[];
}

export interface CriterionResult {
  id: string;
  status: 'done' | 'not_done';
  evidence: string;
}

export interface BuildReport {
  summary: string;
  criteria: CriterionResult[];
  notes: string;
}

export type Severity = 'blocker' | 'major' | 'minor';

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  description: string;
  quote: string;
}

export interface Findings {
  findings: Finding[];
}

export interface Verdict {
  decision: 'approve' | 'changes';
  changes: string[];
  reason: string;
}

export type RiskLevel = 'low' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
}

export type CheckStatus = 'passed' | 'failed' | 'not_run';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  output: string;
}

export interface AppConfig {
  check: string;
  screenshots?: string;
  setup?: string; // p. ej. npm ci, se ejecuta al crear el worktree
  timeouts?: { agent_minutes?: number; builder_minutes?: number; check_minutes?: number };
  low_risk_paths: string[];
  default_branch: string;
}

export interface AppEntry {
  repo: string; // owner/name
  path: string; // clon local
}

export interface AppsFile {
  approver_login: string;
  apps: Record<string, AppEntry>;
}

export type Step =
  | 'spec'
  | 'await_approval'
  | 'build'
  | 'checks'
  | 'review'
  | 'approve'
  | 'risk'
  | 'ship'
  | 'done'
  | 'stuck';

export interface RunState {
  step: Step;
  specRevisions: number;
  buildRounds: number;
  paused: boolean;
  specCommentAt?: string; // ISO; los comandos válidos son posteriores
  reviseNote?: string;
  builderFeedback?: string[];
  branch?: string;
  worktree?: string;
  spec?: Spec;
  buildReport?: BuildReport;
  checks?: CheckResult[];
  findings?: { kept: Finding[]; dropped: { finding: Finding; reason: string }[] };
  verdict?: Verdict;
  risk?: RiskAssessment & { source: 'rules' | 'classifier' };
  outcome?: { kind: 'merged' | 'pr' | 'stuck'; url?: string; reason?: string };
}
