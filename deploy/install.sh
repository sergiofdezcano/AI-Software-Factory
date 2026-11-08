#!/usr/bin/env bash
# Instala la AI Software Factory DENTRO del LXC (Debian 12), como root.
# Se puede repetir: cada paso comprueba lo que ya está hecho.
#
# Uso:
#   1ª vez:  bash install.sh            -> instala el sistema y crea /etc/ai-factory/env de ejemplo
#   rellenar /etc/ai-factory/env (GH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, Telegram)
#   2ª vez:  bash install.sh            -> clona la fábrica y las apps, instala dependencias y el servicio
# No activa el servicio: eso se hace en el corte (ver deploy/HERMES-RUNBOOK.md).
set -euo pipefail

FACTORY_REPO="${FACTORY_REPO:-sergiofdezcano/AI-Software-Factory}"
FACTORY_DIR=/opt/ai-factory
APPS_DIR=/srv/apps
ENV_FILE=/etc/ai-factory/env
USER_NAME=factory

log() { echo -e "\n==> $*"; }
as_factory() { su - "$USER_NAME" -c "set -a; . $ENV_FILE; set +a; $*"; }

[[ $EUID -eq 0 ]] || { echo "Ejecuta como root." >&2; exit 1; }

log "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg sudo jq >/dev/null

if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  log "Node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v gh >/dev/null; then
  log "GitHub CLI"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq && apt-get install -y -qq gh >/dev/null
fi

if ! id "$USER_NAME" >/dev/null 2>&1; then
  log "Usuario $USER_NAME"
  useradd -m -s /bin/bash "$USER_NAME"
fi

if ! command -v codex >/dev/null; then
  log "Codex CLI"
  npm install -g @openai/codex >/dev/null
fi

if [[ ! -x /home/$USER_NAME/.local/bin/claude ]]; then
  log "Claude Code (usuario $USER_NAME)"
  su - "$USER_NAME" -c "curl -fsSL https://claude.ai/install.sh | bash" >/dev/null
fi

install -d -m 0755 "$FACTORY_DIR" "$APPS_DIR"
chown "$USER_NAME:$USER_NAME" "$FACTORY_DIR" "$APPS_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" /etc/ai-factory
  curl -fsSL "https://raw.githubusercontent.com/${FACTORY_REPO}/main/deploy/env.example" -o "$ENV_FILE" 2>/dev/null \
    || printf 'GH_TOKEN=\nCLAUDE_CODE_OAUTH_TOKEN=\nFACTORY_TELEGRAM_BOT_TOKEN=\nFACTORY_TELEGRAM_CHAT_ID=\nFACTORY_APPS_DIR=/srv/apps\n' > "$ENV_FILE"
  chown "$USER_NAME:$USER_NAME" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Creado $ENV_FILE. Rellena GH_TOKEN y CLAUDE_CODE_OAUTH_TOKEN (y Telegram) y vuelve a ejecutar este script."
  exit 0
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
[[ -n "${GH_TOKEN:-}" ]] || { echo "Falta GH_TOKEN en $ENV_FILE." >&2; exit 1; }

log "Git: credenciales vía gh e identidad de los commits"
as_factory "gh auth setup-git"
as_factory "git config --global user.name 'AI Software Factory'"
as_factory "git config --global user.email '${FACTORY_GIT_EMAIL:-ai-factory@users.noreply.github.com}'"

if [[ ! -d "$FACTORY_DIR/.git" ]]; then
  log "Clonando la fábrica en $FACTORY_DIR"
  as_factory "git clone -q https://github.com/${FACTORY_REPO}.git $FACTORY_DIR"
else
  log "Actualizando la fábrica"
  as_factory "git -C $FACTORY_DIR pull -q --ff-only"
fi
as_factory "cd $FACTORY_DIR && npm ci --no-audit --no-fund"

log "Clonando o actualizando las apps de apps.yml en $APPS_DIR"
as_factory "cd $FACTORY_DIR && node deploy/clone-apps.mjs"

log "Playwright: dependencias del sistema (root) y Chromium (usuario $USER_NAME)"
first_app=$(ls -d "$APPS_DIR"/*/ 2>/dev/null | head -1)
if [[ -n "$first_app" && -f "$first_app/package.json" ]]; then
  as_factory "cd $first_app && npm install --no-audit --no-fund >/dev/null"
  (cd "$first_app" && npx --yes playwright install-deps chromium >/dev/null)
  as_factory "cd $first_app && npx playwright install chromium >/dev/null"
fi

log "Servicio systemd (instalado, sin activar)"
install -m 0644 "$FACTORY_DIR/deploy/ai-factory.service" /etc/systemd/system/ai-factory.service
systemctl daemon-reload

log "Comprobaciones"
as_factory "gh auth status 2>&1 | head -3"
as_factory "/home/$USER_NAME/.local/bin/claude --version"
as_factory "codex --version"
as_factory "codex login status 2>&1 | tail -1" || true

cat <<EOF

Listo. Falta, si no está hecho:
  - Login de Codex:  su - $USER_NAME -c 'codex login --device-auth'   (validas el código desde el móvil)
  - Prueba:          su - $USER_NAME -c 'set -a; . $ENV_FILE; set +a; cd $FACTORY_DIR && npx tsx src/cli.ts watch --once --dry-run'
  - Corte:           systemctl enable --now ai-factory   (después de apagar la tarea programada de Windows)
EOF
