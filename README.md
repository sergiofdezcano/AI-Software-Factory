# AI Software Factory

Lleva un issue de GitHub hasta un cambio verificado: lo mergea sola si el riesgo es bajo o te abre una PR. Tú solo apruebas la spec y las PR de riesgo.

Diseño: `docs/superpowers/specs/2026-11-08-software-factory-v1-design.md`.

## Cómo funciona

```
issue con etiqueta "factory"
  → spec writer (Opus) lee el brain de la app y publica la spec en el issue
  → tú respondes /approve o /revise <qué cambiar>
  → builder (Opus) implementa con TDD en un worktree y una rama propios
  → la fábrica ejecuta los controles de la app (npm run check, capturas)
  → revisores con contexto limpio: código (Sonnet) y seguridad (Codex/GPT)
  → hallazgos cuya cita no está en el código se descartan
  → approver (Opus): approve o vuelta al builder (máx. 3 vueltas)
  → riesgo: reglas por rutas en código; el clasificador LLM solo puede subirlo
  → automerge si todo es bajo riesgo y está en verde; si no, PR para ti
```

Las etiquetas del issue muestran el estado: `factory:spec`, `factory:awaiting-spec`, `factory:building`, `factory:reviewing`, `factory:pr`, `factory:merged`, `factory:stuck`, `factory:paused`.

## Uso

```bash
npm install
npm run factory -- run landing 12            # avanza el issue #12 todo lo posible
npm run factory -- run landing 12 --dry-run  # igual, pero sin escribir en GitHub ni hacer push
npm run factory -- status landing 12
```

`run` se puede repetir siempre: retoma desde el último paso guardado en `runs/landing-12/`. Si está esperando tu `/approve`, termina con `Resultado: waiting`. Si se agota la cuota de Claude o Codex, queda en `paused` y el siguiente `run` sigue donde estaba. Para empezar de cero un issue, borra `runs/<app>-<issue>/`.

En `runs/<app>-<issue>/` queda todo: el prompt exacto y la salida de cada agente, los controles, los hallazgos verificados y descartados, y las capturas en `evidence/`.

## Requisitos

- Node 24, `gh` autenticado, `claude` (Claude Code) y `codex` (Codex CLI con `codex login` de ChatGPT).
- Cada app registrada en `apps.yml` con su `.factory.yml` y su carpeta `brain/` en la rama por defecto.

## Añadir una app

1. Añádela a `apps.yml` (`repo` y `path` del clon local).
2. En el repo de la app crea `.factory.yml`:

```yaml
setup: npm install          # opcional, se ejecuta al crear el worktree
check: npm run check        # obligatorio: debe pasar en todo cambio
screenshots: node scripts/factory-screenshots.mjs   # opcional; recibe FACTORY_EVIDENCE_DIR
low_risk_paths:             # lo único que puede mergearse solo
  - src/data/*.json
default_branch: main
```

3. Crea `brain/index.md`, `brain/decisions/` y `brain/features/` con las decisiones que la fábrica no debe contradecir.

## Desarrollo

```bash
npm test          # vitest: lógica determinista y el flujo completo con dobles
npm run typecheck
```

| Archivo | Qué hace |
|---|---|
| `src/pipeline.ts` | máquina de estados: pasos, bucles y límites |
| `src/risk.ts` | reglas de riesgo y condiciones de automerge |
| `src/findings.ts` | descarta hallazgos que no se pueden verificar en el código |
| `src/commands.ts` | lee `/approve` y `/revise`, solo del `approver_login` |
| `src/runners/` | `claude -p` y `codex exec` con permisos impuestos por flags |
| `prompts/` | un prompt por rol |
| `schemas/` | el JSON que debe devolver cada agente |
