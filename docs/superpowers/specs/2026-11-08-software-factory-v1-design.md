# AI Software Factory v1: diseño

Fecha: 2026-11-08
Estado: aprobado en brainstorming, pendiente de plan de implementación.
Contexto previo: `docs/HANDOFF.md`.

## Objetivo

Un proceso repetible y auditable que convierte un issue de GitHub de una app en un cambio verificado: o se mergea solo si el riesgo es bajo, o llega como PR para que el usuario lo apruebe. El usuario interviene en dos puntos: aprueba la spec y aprueba las PR de riesgo.

La v1 se considera terminada cuando dos issues de prueba en la landing piloto recorren el pipeline completo (ver "Aceptación").

## Alcance

**Entra en la v1**

- Entrada por issue de GitHub con la etiqueta `factory`.
- Spec writer que consulta el brain de la app.
- Aprobación de la spec por el usuario en el propio issue.
- Builder con TDD en un worktree y rama propios.
- Controles obligatorios ejecutados por el orquestador.
- Dos revisores con contexto limpio: código (Claude Sonnet) y seguridad (OpenAI vía Codex CLI).
- Approver que decide entre aprobar o volver al builder.
- Clasificación de riesgo con reglas en código y un LLM que solo puede subir el riesgo.
- Automerge o PR.
- Una tarea cada vez.

**Queda fuera (subproyectos posteriores, cada uno con su spec)**

- Entradas por Sentry, voz y Slack.
- Integración con Hermes Agent (como disparador o canal de aprobación).
- Revisores de UX y UI.
- Paralelismo de tareas.
- Despliegue permanente en el servidor Proxmox.
- Sondeo automático de issues; en la v1 se lanza a mano con `factory run`.

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Orquestación | CLI determinista en TypeScript/Node que llama a `claude -p` y `codex exec` | El flujo, los bucles y el riesgo los fija el código, no el criterio de un agente. El mismo comando sirve en local, en GitHub Actions, desde Hermes o en el servidor. |
| Brain | Markdown en el repo de cada app (`brain/`) | Se versiona con el código y las decisiones nuevas entran en la misma PR que el cambio. |
| Revisor de otra familia | Codex CLI con la suscripción de ChatGPT (`codex login`) | Usa la suscripción que ya se paga y lee el repo real, no solo el diff. |
| Interfaz humana | GitHub: etiquetas, comentarios `/approve` y `/revise`, PR | Asíncrona, auditada e igual en local que en el servidor. |
| Riesgo | Rutas de bajo riesgo declaradas por app; el LLM solo puede subir el nivel | Un agente no puede autoconvencerse de que su cambio es trivial. |

## Arquitectura

### Repo de la fábrica (`AI-Software-Factory`)

```
factory/
  cli.ts                 entrada: `factory run <app> <issue> [--dry-run]`
  pipeline.ts            máquina de estados: pasos fijos, bucles con límite, reanudación
  state.ts               lectura/escritura de runs/<app>-<issue>/state.json
  steps/
    spec.ts              paso 1
    await-approval.ts    paso 2
    build.ts             paso 3
    checks.ts            paso 4
    review.ts            paso 5
    approve.ts           paso 6
    risk.ts              paso 7
    ship.ts              paso 8
  runners/
    claude.ts            envuelve `claude -p` (modelo, herramientas, salida JSON)
    codex.ts             envuelve `codex exec` en sandbox de solo lectura
  github.ts              issues, comentarios, etiquetas, PR, merge (vía `gh`)
  findings.ts            verificación de citas de hallazgos contra el código
  apps.ts                registro de apps: nombre → repo y ruta local
prompts/
  spec-writer.md
  builder.md
  reviewer-code.md
  reviewer-security.md
  approver.md
  risk-classifier.md
schemas/
  spec.schema.json
  build-report.schema.json
  findings.schema.json
  verdict.schema.json
  risk.schema.json
  app-config.schema.json
apps.yml                 apps registradas y `approver_login` (usuario de GitHub cuyos comandos cuentan)
runs/                    estado y evidencia por ejecución (en .gitignore)
```

### Repo de cada app

```
.factory.yml             configuración de la app para la fábrica
brain/
  index.md               resumen de la app y enlaces
  decisions/NNNN-titulo.md  una decisión por archivo: contexto, decisión, consecuencias
  features/<feature>.md  lo que el usuario puede hacer hoy
```

`.factory.yml` de la landing:

```yaml
check: npm run check
screenshots: node scripts/screenshot.mjs
low_risk_paths:
  - src/data/*.json
  - src/styles/**
default_branch: main
```

### Principios

- Cada paso de agente arranca con contexto limpio. Recibe archivos concretos (spec, diff, brain, lista de cambios), nunca el historial de otro agente.
- Toda salida de un agente es JSON validado contra su esquema en `schemas/`. Si no valida, se reintenta una vez con el error de validación; si vuelve a fallar, el paso falla.
- El código decide el flujo, los límites y el riesgo. Los agentes solo producen artefactos.

## Flujo

El estado de la tarea se refleja en etiquetas del issue: `factory:spec`, `factory:awaiting-spec`, `factory:building`, `factory:reviewing`, `factory:pr`, `factory:merged`, `factory:stuck`, `factory:paused`.

### 0. Entrada

El usuario pone `factory` en un issue y ejecuta `factory run <app> <issue>`. El orquestador comprueba la etiqueta, toma el bloqueo, crea `runs/<app>-<issue>/state.json` y pone `factory:spec`.

### 1. Spec writer (Claude Opus)

Entrada: el issue con sus comentarios, todo `brain/`, el árbol del repo y `.factory.yml`. En revisiones, también el comentario de `/revise`.

Salida (`spec.schema.json`):

- `stories[]`: acción del usuario, condiciones, permisos y resultado esperado.
- `must_respect[]`: decisiones o features del brain afectadas, cada una con la ruta del archivo.
- `acceptance[]`: criterio, cómo se demuestra (`test`, `command` o `screenshot`) y qué evidencia queda.
- `out_of_scope[]`: lo que no debe tocar.
- `open_questions[]`: lo que no puede decidir solo.
- `brain_updates[]`: decisiones o features que habrá que añadir o modificar.

El orquestador publica la spec como comentario en Markdown y pone `factory:awaiting-spec`. Si hay `open_questions`, el comentario las pide expresamente.

### 2. Aprobación de la spec

El orquestador lee los comentarios del issue posteriores a la spec. Solo cuentan los del `approver_login` de `apps.yml` (en la v1, `sergiofdezcano`).

- `/approve`: pasa al paso 3.
- `/revise <texto>`: vuelve al paso 1 con el texto. Máximo 3 revisiones; a la cuarta, `factory:stuck`.
- Sin respuesta: el run termina y se retoma al volver a ejecutar `factory run`.

### 3. Builder (Claude Opus)

El orquestador crea el worktree en la rama `factory/<issue>-<slug>` desde `default_branch`. El builder recibe la spec aprobada, `brain/` y, en vueltas posteriores, solo la lista de cambios del approver o los controles fallidos.

Trabaja en TDD por criterio de aceptación: test en rojo, implementación, test en verde. Aplica `brain_updates` en `brain/`. Hace commits en la rama, pero no tiene `git push` ni `gh`.

Salida (`build-report.schema.json`): por cada criterio, el estado y la evidencia (test, comando y salida, o ruta de la captura).

### 4. Controles obligatorios (código)

El orquestador ejecuta `check` y `screenshots` de `.factory.yml` en el worktree, sin fiarse del informe del builder. Cada control queda como `passed`, `failed` o `not_run`.

- `failed`: vuelve al paso 3 con la salida del control. Cuenta como vuelta del bucle de construcción.
- `not_run`: bloquea el cierre y se muestra en el resumen.
- Un criterio de aceptación sin evidencia en el informe cuenta como `not_run`.

### 5. Revisores (en paralelo, contexto limpio)

- **Código**: Claude Sonnet, con herramientas de solo lectura sobre el worktree.
- **Seguridad**: `codex exec` con sandbox de solo lectura sobre el worktree.

Ambos reciben la spec y el diff contra `default_branch`. Devuelven (`findings.schema.json`) hallazgos con archivo, línea, severidad (`blocker`, `major`, `minor`), descripción y la cita literal del código.

`findings.ts` descarta los hallazgos cuya cita no aparece en el archivo indicado y registra el descarte.

### 6. Approver (Claude Opus)

Entrada: spec, informe del builder, resultado de los controles y hallazgos verificados.

Salida (`verdict.schema.json`): `approve` o `changes` con una lista concreta de cambios.

- `changes`: vuelve al paso 3 con esa lista.
- Máximo 3 vueltas de construcción (pasos 3 a 6). Si se agotan, `factory:stuck` y un comentario con lo pendiente.
- El orquestador no acepta `approve` si hay controles `failed` o `not_run`, o hallazgos `blocker` verificados.

### 7. Riesgo

1. Reglas (`risk.ts`): si algún archivo del diff queda fuera de `low_risk_paths`, el riesgo es `high` y no se consulta al LLM.
2. Si todo está dentro, el clasificador (Claude Opus, `risk.schema.json`) devuelve `low` o `high` con un motivo. Solo puede mantener `low` o subir a `high`.
3. Hay automerge solo si el riesgo final es `low`, todos los controles están en `passed`, el approver dio `approve` y ningún revisor dejó hallazgos `blocker` o `major` verificados.

### 8. Cierre

El orquestador hace push de la rama.

- Automerge: abre la PR y la mergea con `gh pr merge --squash`, comenta en el issue y pone `factory:merged`.
- En otro caso: abre la PR con la spec, la evidencia, las capturas, los hallazgos y el motivo del riesgo en la descripción, y pone `factory:pr`.

Después borra el worktree, libera el bloqueo y guarda el resumen en `runs/`.

## Errores, reanudación y límites

- **Reanudación**: cada paso guarda su salida en `runs/<app>-<issue>/` antes de avanzar. `factory run` retoma desde el último paso completado.
- **Límites en código**: 3 revisiones de spec, 3 vueltas de construcción, un tiempo máximo por paso (configurable, 30 min por defecto para el builder y 10 min para el resto) y un máximo de turnos para el builder (`--max-turns`). Al superarlos, `factory:stuck` con el motivo.
- **Cuota agotada**: si `claude` o `codex` devuelve un error de límite de uso, el paso queda pendiente, el issue pasa a `factory:paused` y el siguiente `factory run` lo reintenta.
- **Permisos**: el builder tiene escritura solo en su worktree y no tiene `git push` ni `gh`. Revisores, approver y clasificador son de solo lectura. Se impone con `--allowedTools` / `--disallowedTools` de Claude Code y el sandbox de Codex, no con el prompt.
- **Concurrencia**: un archivo de bloqueo impide dos runs a la vez.
- **Auditoría**: por cada paso se guarda el prompt exacto, la salida cruda, el JSON validado, el modelo y la duración.
- **`--dry-run`**: ejecuta todo menos las escrituras en GitHub (comentarios, etiquetas, push, PR, merge), que se imprimen.

## Pruebas de la fábrica

- **Unitarias (vitest)**: máquina de estados y reanudación, reglas de riesgo, validación de esquemas, verificación de citas, lectura de `/approve` y `/revise` (incluido ignorar a otros autores) y condiciones de automerge.
- **Flujo completo con dobles**: los runners se sustituyen por dobles que devuelven JSON fijo, y `github.ts` por un doble en memoria. Se cubren el camino feliz, la revisión de spec, el bucle de cambios, el control fallido, el agotamiento de límites y la cuota agotada.

## Aceptación

Con la landing (`sergiofdezcano/Serg4Cano-Landing-Page`) registrada y su `brain/` inicial creado:

1. Un issue que solo toque `src/data/setup.json` (por ejemplo, añadir un elemento de equipamiento) termina en automerge, con evidencia de `npm run check` y capturas.
2. Un issue que toque un componente en `src/components/` termina en PR con la spec, la evidencia y los hallazgos en la descripción.

## Requisitos previos

- Instalar Codex CLI (`npm i -g @openai/codex`) e iniciar sesión con la cuenta de ChatGPT.
- `gh` autenticado con permisos sobre el repo de la app.
- Crear `brain/` y `.factory.yml` en la landing; puede ser la primera tarea manual del plan.
