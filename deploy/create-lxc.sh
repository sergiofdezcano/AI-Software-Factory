#!/usr/bin/env bash
# Crea el LXC de la AI Software Factory. Se ejecuta en el HOST Proxmox como root.
# Se puede repetir: si ya existe un contenedor con ese hostname, no hace nada.
#
# Variables opcionales (con sus valores por defecto):
#   CTID=<siguiente libre>  CT_HOSTNAME=ai-factory  STORAGE=local-lvm  BRIDGE=vmbr0
#   CORES=4  MEMORY=8192  DISK_GB=40  IP=dhcp (o 192.168.1.50/24 con GATEWAY=192.168.1.1)
set -euo pipefail

CT_HOSTNAME="${CT_HOSTNAME:-ai-factory}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
CORES="${CORES:-4}"
MEMORY="${MEMORY:-8192}"
DISK_GB="${DISK_GB:-40}"
IP="${IP:-dhcp}"
GATEWAY="${GATEWAY:-}"

command -v pct >/dev/null || { echo "Esto se ejecuta en el host Proxmox (no encuentro pct)." >&2; exit 1; }

existing=$(pct list | awk -v h="$CT_HOSTNAME" 'NR>1 && $NF==h {print $1}')
if [[ -n "$existing" ]]; then
  echo "Ya existe el LXC $existing ($CT_HOSTNAME). No toco nada."
  pct status "$existing"
  exit 0
fi

CTID="${CTID:-$(pvesh get /cluster/nextid)}"

# Plantilla Debian 12: la versión con soporte oficial de dependencias de Playwright.
pveam update >/dev/null
TEMPLATE=$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)
[[ -n "$TEMPLATE" ]] || { echo "No encuentro la plantilla debian-12-standard en pveam." >&2; exit 1; }
if ! pveam list local | grep -q "$TEMPLATE"; then
  pveam download local "$TEMPLATE"
fi

NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
[[ -n "$GATEWAY" ]] && NET="${NET},gw=${GATEWAY}"

pct create "$CTID" "local:vztmpl/${TEMPLATE}" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$MEMORY" --swap 1024 \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "$NET" \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 --start 1 \
  --description "AI Software Factory (github.com/sergiofdezcano/AI-Software-Factory)"

# Esperar a que tenga red.
for _ in $(seq 1 30); do
  ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}') || true
  [[ -n "${ip:-}" ]] && break
  sleep 2
done

echo "LXC $CTID ($CT_HOSTNAME) creado y arrancado. IP: ${ip:-desconocida}"
echo "Siguiente paso: pct exec $CTID -- bash -c 'apt-get update && apt-get install -y git curl' y ejecutar deploy/install.sh dentro."
