#!/usr/bin/env bash
# Actualiza la fábrica en el LXC tras mergear cambios en main. Como root dentro del LXC.
set -euo pipefail
su - factory -c "git -C /opt/ai-factory pull -q --ff-only && cd /opt/ai-factory && npm ci --no-audit --no-fund >/dev/null"
install -m 0644 /opt/ai-factory/deploy/ai-factory.service /etc/systemd/system/ai-factory.service
systemctl daemon-reload
# Si hay un run en curso, systemd lo corta; el siguiente arranque lo retoma desde el último paso guardado.
systemctl restart ai-factory
systemctl --no-pager status ai-factory | head -5
