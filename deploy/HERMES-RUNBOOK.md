# Runbook: montar la AI Factory en Proxmox (para Hermes)

Hermes: este documento te dice cómo dejar funcionando la AI Software Factory en un LXC nuevo del Proxmox de Sergio. Ejecuta los pasos en orden. Después de cada uno, cuéntale a Sergio en una línea qué ha pasado. **Para en cuanto algo falle**, y no improvises cambios fuera de lo que dice aquí.

Repo: https://github.com/sergiofdezcano/AI-Software-Factory (rama `main`).

## 0. Comprobar acceso
- Tienes que poder ejecutar comandos como root en el **host Proxmox** (por SSH o como te lo haya configurado Sergio).
- Comprueba: `pveversion` y `pvesm status` (para elegir el storage).
- Si no tienes acceso, para y díselo.

## 1. Crear el LXC (en el host Proxmox)
```bash
curl -fsSL https://raw.githubusercontent.com/sergiofdezcano/AI-Software-Factory/main/deploy/create-lxc.sh -o /root/create-ai-factory-lxc.sh
STORAGE=<storage con espacio, p. ej. local-lvm> bash /root/create-ai-factory-lxc.sh
```
Apunta el **CTID** y la **IP** que imprime. Si Sergio quiere IP fija, añade `IP=192.168.x.y/24 GATEWAY=192.168.x.1`.

## 2. Primera instalación (dentro del LXC)
```bash
pct exec <CTID> -- bash -c "apt-get update -qq && apt-get install -y -qq curl git >/dev/null"
pct exec <CTID> -- bash -c "curl -fsSL https://raw.githubusercontent.com/sergiofdezcano/AI-Software-Factory/main/deploy/install.sh -o /root/install.sh && bash /root/install.sh"
```
Esta primera pasada instala el sistema y crea `/etc/ai-factory/env` vacío.

## 3. Secretos (los da Sergio)
Pídele a Sergio estos valores **uno a uno por privado**. No los repitas en el chat ni los guardes en tu memoria.

| Variable | De dónde sale |
|---|---|
| `GH_TOKEN` | Token *fine-grained* de GitHub creado por Sergio. Repos: Serg4Cano-Landing-Page y AI-Software-Factory. Permisos: Contents, Issues y Pull requests (read/write). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Sergio ejecuta `claude setup-token` en su PC y te pasa el token. |
| `FACTORY_TELEGRAM_BOT_TOKEN` | El token de **tu** bot de Telegram, el mismo que usas tú. |
| `FACTORY_TELEGRAM_CHAT_ID` | El chat id de Sergio contigo. |

Escríbelos así, uno por variable:
```bash
pct exec <CTID> -- sed -i 's|^GH_TOKEN=.*|GH_TOKEN=<valor>|' /etc/ai-factory/env
```
Comprueba sin enseñar los valores: `pct exec <CTID> -- bash -c "grep -c '=.\+' /etc/ai-factory/env"`.

## 4. Segunda instalación
```bash
pct exec <CTID> -- bash /root/install.sh
```
Clona la fábrica y las apps, instala Playwright y deja instalado el servicio `ai-factory` sin activarlo.

## 5. Login de Codex (con Sergio)
```bash
pct exec <CTID> -- su - factory -c "codex login --device-auth"
```
Envía a Sergio la URL y el código que aparecen. Él lo valida desde el móvil. Después comprueba:
`pct exec <CTID> -- su - factory -c "codex login status"` → `Logged in using ChatGPT`.

## 6. Prueba sin tocar nada
```bash
pct exec <CTID> -- su - factory -c "set -a; . /etc/ai-factory/env; set +a; cd /opt/ai-factory && npx tsx src/cli.ts watch --once --dry-run"
```
Tiene que terminar sin errores. Prueba también que Codex puede ejecutarse con su sandbox dentro del LXC:
```bash
pct exec <CTID> -- su - factory -c "cd /srv/apps/landing && echo 'Responde solo: ok' | codex exec --sandbox read-only --skip-git-repo-check -"
```
Si falla por el sandbox (landlock o seccomp), para y avisa a Sergio: habrá que activar `keyctl=1` en el LXC o usar una VM.

## 7. Corte (Sergio confirma antes)
1. Sergio desactiva la tarea de Windows: `schtasks /Change /TN "AI Software Factory" /Disable`.
2. Arranca el servicio:
   ```bash
   pct exec <CTID> -- systemctl enable --now ai-factory
   pct exec <CTID> -- systemctl --no-pager status ai-factory | head -5
   ```
3. Logs: `pct exec <CTID> -- journalctl -u ai-factory -n 50 --no-pager`.

## 8. Skill «ai-factory» para ti
- Copia `integrations/hermes/ai-factory/SKILL.md` del repo a tu carpeta de skills.
- Usa para ella un `gh` con un token propio, **solo Issues (read/write)** en los repos de las apps. Es distinto del `GH_TOKEN` de la fábrica.
- Prueba: crea un issue de prueba con la etiqueta `factory`, por ejemplo «Prueba de la fábrica desde Telegram: cambiar el texto del pie a …», que te dirá Sergio. Sigue su estado hasta que llegue el aviso de la fábrica.

## Mantenimiento
- Actualizar tras cambios en la fábrica: `pct exec <CTID> -- bash /opt/ai-factory/deploy/update.sh`
- Estado: `systemctl status ai-factory` y `journalctl -u ai-factory`.
- Registro de cada tarea: `/opt/ai-factory/runs/<app>-<issue>/`.
