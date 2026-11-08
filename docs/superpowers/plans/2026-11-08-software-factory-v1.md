# Software Factory v1: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI `factory run <app> <issue>` que lleva un issue de GitHub hasta automerge o PR según `docs/superpowers/specs/2026-11-08-software-factory-v1-design.md`.

**Architecture:** Un orquestador determinista en TypeScript recorre una máquina de estados persistida en `runs/<app>-<issue>/state.json`. Cada paso de agente llama a `claude -p --json-schema` o `codex exec --output-schema` con contexto limpio y valida la salida con Ajv. GitHub, git, los agentes y los comandos de comprobación entran como dependencias inyectadas, así el flujo completo se prueba con dobles.

**Tech Stack:** Node 24, TypeScript ejecutado con `tsx`, vitest, ajv, yaml, picomatch, execa.

---

## Estructura de archivos

```
package.json, tsconfig.json, vitest.config.ts, .gitignore
apps.yml                         registro de apps y approver_login
schemas/*.schema.json            spec, build-report, findings, verdict, risk, app-config
prompts/*.md                     un prompt por rol
src/
  types.ts                       tipos compartidos (Spec, BuildReport, Finding, Verdict, RunState…)
  schema.ts                      carga de esquemas y validate(name, data)
  config.ts                      loadApps(), loadAppConfig(repoPath)
  state.ts                       loadState/saveState/saveArtifact
  commands.ts                    parseApproval(comments, sinceIso, login)
  risk.ts                        rulesRisk(), combineRisk(), canAutomerge()
  findings.ts                    verifyFindings()
  render.ts                      specToMarkdown(), prBody()
  prompts.ts                     renderPrompt(role, sections)
  runners/types.ts               AgentRunner, AgentCall, QuotaError
  runners/claude.ts              ClaudeRunner
  runners/codex.ts               CodexRunner
  github.ts                      GitHub (interfaz), GhCli, DryRunGitHub
  git.ts                         Git (interfaz), GitCli
  checks.ts                      CheckRunner (interfaz), ShellChecks
  pipeline.ts                    runPipeline(deps, ctx)
  cli.ts                         entrada
tests/                           un test por módulo de src/ + pipeline.test.ts con dobles
```

## Tareas

### Task 1: Andamiaje
- [ ] `package.json` con scripts `test` (vitest run), `typecheck` (tsc --noEmit), `factory` (tsx src/cli.ts); dependencias ajv, ajv-formats, yaml, picomatch, execa; dev: typescript, tsx, vitest, @types/node, @types/picomatch.
- [ ] `tsconfig.json` (ESNext, NodeNext, strict, noEmit), `.gitignore` (`node_modules`, `runs/`).
- [ ] `npm install`, `npm test` pasa sin tests (`passWithNoTests`). Commit.

### Task 2: Tipos y esquemas
- [ ] `src/types.ts` con los tipos de la spec de diseño.
- [ ] `schemas/*.schema.json` (draft 2020-12, `additionalProperties: false`).
- [ ] Test: `validate('spec', ejemploValido)` pasa; sin `acceptance` falla con mensaje que nombra el campo. Igual para findings y verdict.
- [ ] Implementar `src/schema.ts` con Ajv. Commit.

### Task 3: Configuración
- [ ] Test: `loadApps('apps.yml')` devuelve apps y `approver_login`; app desconocida lanza error. `loadAppConfig(dir)` lee `.factory.yml` y valida contra `app-config`.
- [ ] Implementar `src/config.ts`. Crear `apps.yml` con la landing. Commit.

### Task 4: Estado de la ejecución
- [ ] Test: `loadState` sin archivo devuelve estado inicial `{step:'spec', specRevisions:0, buildRounds:0}`; `saveState` + `loadState` es idempotente; `saveArtifact(name, data)` escribe `NN-name.json` con contador creciente.
- [ ] Implementar `src/state.ts`. Commit.

### Task 5: Comandos de aprobación
- [ ] Test: ignora comentarios anteriores a `since`; ignora autores distintos de `login`; `/approve` → approve; `/revise texto` → revise con texto; el último comando válido gana.
- [ ] Implementar `src/commands.ts`. Commit.

### Task 6: Riesgo
- [ ] Test: `rulesRisk(['src/data/setup.json'], ['src/data/*.json'])` = low; con `src/components/X.astro` = high; lista vacía de archivos = high. `combineRisk('high', anything)` = high sin llamar al LLM; `combineRisk('low', 'high')` = high. `canAutomerge` exige low, todos los checks passed, verdict approve y ningún hallazgo blocker/major.
- [ ] Implementar `src/risk.ts`. Commit.

### Task 7: Verificación de hallazgos
- [ ] Test: hallazgo cuya `quote` aparece en el archivo se mantiene; cita inexistente o archivo inexistente se descarta con motivo; normaliza espacios y saltos de línea CRLF.
- [ ] Implementar `src/findings.ts`. Commit.

### Task 8: Render
- [ ] Test: `specToMarkdown` incluye historias, criterios, `must_respect` y preguntas abiertas, y termina con instrucciones `/approve` y `/revise`. `prBody` incluye evidencia, checks, hallazgos y motivo de riesgo.
- [ ] Implementar `src/render.ts`. Commit.

### Task 9: Runners de agentes
- [ ] Test con un `exec` inyectado: ClaudeRunner pasa `-p --output-format json --json-schema --model --allowedTools/--disallowedTools --max-turns`, envía el prompt por stdin, extrae `structured_output` (o parsea `result`), detecta errores de cuota y lanza `QuotaError`. CodexRunner usa `exec --sandbox read-only --output-schema <tmp> -o <tmp> -` y lee el archivo de salida.
- [ ] Implementar. Commit.

### Task 10: GitHub, git y checks
- [ ] `GhCli` sobre `gh` (issue view --json, comentarios, labels, pr create, pr merge --squash). `DryRunGitHub` delega lecturas y registra escrituras.
- [ ] `GitCli`: worktree add/remove, changedFiles(base), diff(base), push.
- [ ] `ShellChecks`: ejecuta un comando con timeout y devuelve passed/failed + salida.
- [ ] Test de DryRunGitHub (no escribe, registra). Commit.

### Task 11: Prompts
- [ ] `prompts/*.md` para los seis roles; `renderPrompt` sustituye `{{seccion}}`. Test de render. Commit.

### Task 12: Pipeline
- [ ] Tests con dobles: camino feliz hasta automerge; ruta fuera de low_risk → PR; `/revise` vuelve a spec; sin respuesta se detiene en `awaiting-spec` y reanuda; check fallido vuelve a build; `changes` tres veces → stuck; QuotaError → paused y reanuda; approve rechazado si hay check failed.
- [ ] Implementar `src/pipeline.ts`. Commit.

### Task 13: CLI y aceptación en dry-run
- [ ] `src/cli.ts`: `factory run <app> <issue> [--dry-run]` con bloqueo de archivo.
- [ ] Preparar en la landing `.factory.yml` y `brain/` en una rama.
- [ ] README de la fábrica con uso y requisitos. Commit.
