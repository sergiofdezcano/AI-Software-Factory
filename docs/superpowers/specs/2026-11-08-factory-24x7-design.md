# AI Software Factory 24/7: servidor, Telegram y más Codex

Fecha: 2026-11-08
Estado: aprobado en brainstorming.
Base: `2026-11-08-software-factory-v1-design.md` (pipeline v1, ya en producción en Windows).

## Objetivo

Pedir trabajo a la fábrica desde cualquier dispositivo, por Telegram, y que lo haga aunque el PC esté apagado.

**Terminado cuando:** con el PC de Windows apagado, el usuario pide una tarea a Hermes por Telegram, la fábrica la construye en el LXC y el aviso del resultado llega al mismo chat.

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Dónde corre la fábrica | LXC dedicado `ai-factory` en Proxmox (Debian 12, sin privilegios, 4 núcleos, 8 GB, 40 GB) | Ligero, se respalda con Proxmox y es un sistema limpio para Node, Playwright y los CLIs |
| Intermediario | El Hermes que ya existe en Proxmox y ya habla por Telegram, con una skill «AI Factory» | El usuario ya habla con él y usa la suscripción de Codex. No hace falta un segundo bot |
| Cola | Siguen siendo los issues de GitHub con la etiqueta `factory` | Hermes y la fábrica no se conocen entre sí. Si Hermes falla, la fábrica sigue y se pueden crear issues desde la app de GitHub |
| Avisos | La fábrica llama a `sendMessage` de la API de Telegram con el token del bot de Hermes y el chat del usuario | Llegan al mismo chat. Enviar mensajes no interfiere con el long polling de Hermes |
| Más Codex | Reserva cruzada Claude ↔ Codex en todos los roles; la revisión de seguridad sigue siendo de Codex | Si se agota la cuota de una suscripción, la tarea no se para |
| Puesta a punto del servidor | Hermes, que tiene acceso a la LAN, ejecuta los scripts de `deploy/` siguiendo `deploy/HERMES-RUNBOOK.md` | Repetible. El usuario solo valida los logins desde el móvil |

## Componentes

### En el repo de la fábrica

- `src/runners/codex.ts`: modo escritura con `--sandbox workspace-write` (sin red). El orquestador hace los commits del builder.
- `src/cli.ts`: cada rol es un `FallbackRunner` (principal → reserva):
  - spec writer, builder, approver y riesgo: Claude Opus → Codex
  - revisor de código: Claude Sonnet → Codex
  - revisor de seguridad: Codex → Claude Sonnet
- `src/notify.ts`: `Notifier` con una implementación para Telegram y otra vacía. Avisa de spec publicada, PR abierta, mergeado, atascado, en pausa y cambio de modelo por cuota. Si las variables no están configuradas, no hace nada.
- `src/config.ts`: `FACTORY_APPS_DIR` sustituye la ruta local de cada app por `<dir>/<app>`, para que el mismo `apps.yml` sirva en Windows y en el servidor.
- `deploy/create-lxc.sh`: se ejecuta en el host Proxmox. Crea el LXC con `pct create` (Debian 12, sin privilegios, `nesting=1`) y lo arranca. No hace nada si el LXC ya existe.
- `deploy/install.sh`: se ejecuta dentro del LXC como root y se puede repetir. Hace lo siguiente:
  - instala Node 24, git, `gh`, `claude`, `codex` y las dependencias de Chromium;
  - crea el usuario `factory`;
  - clona la fábrica en `/opt/ai-factory` y las apps en `/srv/apps/<app>`, y hace `npm ci`;
  - instala Playwright Chromium;
  - instala las unidades systemd sin activarlas.
- `deploy/ai-factory.service`: ejecuta `factory watch --interval 120` como `factory`, con `Restart=always` y `EnvironmentFile=/etc/ai-factory/env`.
- `deploy/env.example`:
  - `CLAUDE_CODE_OAUTH_TOKEN`, `GH_TOKEN`
  - `FACTORY_TELEGRAM_BOT_TOKEN`, `FACTORY_TELEGRAM_CHAT_ID`
  - `FACTORY_APPS_DIR=/srv/apps`
- `deploy/HERMES-RUNBOOK.md`: los pasos que Hermes ejecuta y los que hace el usuario (logins).
- `integrations/hermes/ai-factory/SKILL.md`: la skill para Hermes.

### Skill de Hermes «AI Factory»

- **Crear tarea:** a partir del mensaje del usuario, redacta un issue con título claro, contexto y resultado esperado, sin inventar datos. Lo crea con `gh issue create -R <repo> --label factory` y devuelve el enlace.
- **Estado:** `gh issue view` con las etiquetas `factory:*` y el último comentario de la fábrica, resumido en una frase.
- **En curso:** `gh issue list --label factory --state open`.
- **Permisos:** usa un token *fine-grained* propio, solo con «Issues: read/write» en los repos de las apps. No puede tocar código, PR ni merges.
- **Apps conocidas:** tabla nombre → repo en la skill (hoy `landing` → `sergiofdezcano/Serg4Cano-Landing-Page`).

## Logins en el servidor

- **Claude:** el usuario ejecuta `claude setup-token` en cualquier máquina con navegador y el token de larga duración se guarda en `/etc/ai-factory/env`.
- **Codex:** `codex login --device-auth` como usuario `factory`. El usuario valida el código desde el móvil.
- **GitHub:** un token *fine-grained* para la fábrica, con «Contents», «Issues» y «Pull requests» read/write en los repos de las apps.
- `/etc/ai-factory/env` con permisos 600, propiedad de `factory`.

## Corte desde Windows

1. Hermes crea e instala el LXC (runbook, pasos 1-4). El usuario completa los logins (paso 5).
2. `factory watch --once --dry-run` en el LXC sin errores.
3. Se desactiva la tarea programada de Windows y se arranca `ai-factory.service`.
4. Issue de prueba creado desde Telegram vía Hermes: llegan los avisos y se entrega de punta a punta.
5. Windows queda solo como entorno de desarrollo de la fábrica.

## Errores

- **Cuota:** primero se usa la reserva. Si las dos suscripciones están agotadas, la tarea queda en pausa (`paused`) como hoy y se avisa por Telegram.
- **Fallo al enviar un aviso:** se registra en el log y no interrumpe el pipeline.
- **Servicio caído:** systemd lo reinicia. El bloqueo de un PID que ya no existe se libera solo (ya implementado).

## Pruebas

- Unitarias: `Notifier` de Telegram con fetch inyectado, sin enviar mensajes reales; Codex en modo escritura (argumentos); `FACTORY_APPS_DIR`; avisos del pipeline (qué evento en qué paso).
- `deploy/install.sh`: `bash -n` y shellcheck si está disponible. La prueba real es el runbook.
- Aceptación: el criterio de «Terminado cuando».

## Fuera de alcance

Sentry, voz, Slack, revisores de UX/UI, paralelismo, webhooks de GitHub (se sigue sondeando) y alta disponibilidad.
